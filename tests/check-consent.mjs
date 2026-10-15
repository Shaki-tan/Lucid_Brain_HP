// 同意ダイアログの文言と、その記録経路を確認する（SPEC §8.3 / §8.4）。
//
// 文言の出どころは public/products/<slug>/assets/consent-items.json だけである。
// ブラウザのダイアログと、決済時の Stripe への記録が、同じファイルを読む。
// ここが崩れると「版番号は残るが文言が残らない決済」が生まれるため、機械で確かめる。
//
// 見るもの:
//   - セットの形（言語ごとの items と、有償プランの summary）と、日英の数の一致
//   - items のリンク先が実在すること
//   - summary に products.js の値（価格・期間）がそのまま書かれていること
//   - Stripe の metadata の上限に収まること
//   - ページの data-consent-version が products.js と一致すること（食い違うと /api/checkout が 409 で止める）
//   - consentVersion が、items のリンク先の法務文書の改定日より前でないこと（改定して版を上げ忘れるのを止める）
//
// 依存を持ち込まないため、ランナーに同梱の Node だけで動かす。
//
//   node tests/check-consent.mjs

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PRODUCTS, resolvePlan } from '../functions/lib/products.js'
import { normalizeLang, toConsentMetadata, toSummaryText } from '../functions/lib/consent.js'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const PUBLIC_DIR = join(ROOT, 'public')

// Stripe の制限（SPEC §8.4）
const METADATA_KEY_LIMIT = 40
const METADATA_VALUE_LIMIT = 500
const METADATA_KEY_COUNT_LIMIT = 50
// 決済側が他に入れるキー: consent_version / consent_at / product / plan / consent_at_client
const OTHER_METADATA_KEYS = 5

const LANGS = ['ja', 'en']

// summary の checks に書ける印と、その行に書かれているべき文字列
const SUMMARY_CHECKS = {
  unitAmount: (plan) => plan.unitAmount?.toLocaleString('en-US'),
  downloadWindowHours: (plan) => plan.downloadWindowHours,
  duplicateWindowHours: (plan) => plan.duplicateWindowHours,
}

// 版は日付。同じ日に2回上げるときは .2 を付ける（SPEC §8.3）
const CONSENT_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}(\.\d+)?$/

let hasFailure = false

function fail(message) {
  console.log(`NG  ${message}`)
  hasFailure = true
}

function itemsPath(productId) {
  return join(PUBLIC_DIR, 'products', productId, 'assets', 'consent-items.json')
}

// ルート相対のパスを public/ の実ファイルに対応づける（check-links.sh と同じ規則）
function toPublicFile(path) {
  const base = join(PUBLIC_DIR, path)
  return [base, `${base}.html`, join(base, 'index.html')].find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
}

function listHtml(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return listHtml(full)
    return entry.endsWith('.html') ? [full] : []
  })
}

// 数字の前後が数字でないこと。72 が 720 に含まれて通るのを防ぐ
function containsValue(text, value) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`).test(text)
}

console.log('== 同意ダイアログの文言 ==')

let checkedPlans = 0

for (const [productId, product] of Object.entries(PRODUCTS)) {
  const consentPlans = Object.entries(product.plans).filter(([, plan]) => plan.consentSet)
  if (consentPlans.length === 0) continue

  const file = itemsPath(productId)
  if (!existsSync(file)) {
    fail(`${productId}: ${file} が無い。同意を取るプランがあるのに文言のファイルが無い`)
    continue
  }

  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (cause) {
    fail(`${productId}: consent-items.json が JSON として読めない（${cause.message}）`)
    continue
  }

  for (const [planId, plan] of consentPlans) {
    checkedPlans += 1
    const where = `${productId}/${planId}`
    const set = data?.sets?.[plan.consentSet]
    if (!set) {
      fail(`${where}: consentSet "${plan.consentSet}" が consent-items.json に無い`)
      continue
    }

    if (!CONSENT_VERSION_PATTERN.test(plan.consentVersion ?? '')) {
      fail(`${where}: consentVersion が YYYY-MM-DD（同じ日の2回目以降は .2 等）の形ではない（${plan.consentVersion}）`)
    }

    // 有償プランは最終確認画面の表示事項（summary）を持つ。無料版は持たない
    const needsSummary = plan.billing !== 'free'
    const linkedFiles = new Set()

    for (const lang of LANGS) {
      const content = set[lang]
      const items = content?.items
      if (!Array.isArray(items) || items.length === 0) {
        fail(`${where}: ${lang} の items が無い`)
        continue
      }

      items.forEach((item, index) => {
        for (const key of ['label', 'linkText', 'href']) {
          if (typeof item?.[key] !== 'string' || item[key].length === 0) {
            fail(`${where}/${lang}.items[${index}]: ${key} が無い`)
          }
        }
        // リンク先が実在すること。フラグメント付き（/legal/tokushoho#pawgress）は、その id があることまで見る
        if (typeof item?.href === 'string' && item.href.startsWith('/')) {
          const [path, fragment] = item.href.split('#')
          const target = toPublicFile(path)
          if (!target) {
            fail(`${where}/${lang}.items[${index}]: リンク先が無い（${item.href}）`)
          } else {
            linkedFiles.add(target)
            if (fragment && !readFileSync(target, 'utf8').includes(`id="${fragment}"`)) {
              fail(`${where}/${lang}.items[${index}]: リンク先に id="${fragment}" が無い（${item.href}）`)
            }
          }
        }
      })

      const summary = Array.isArray(content.summary) ? content.summary : []
      if (needsSummary && summary.length === 0) {
        fail(`${where}: ${lang} の summary が無い。有償プランは購入の条件を本文として出す（SPEC §8.3）`)
      }
      const covered = new Set()
      summary.forEach((row, index) => {
        for (const key of ['term', 'detail']) {
          if (typeof row?.[key] !== 'string' || row[key].length === 0) {
            fail(`${where}/${lang}.summary[${index}]: ${key} が無い`)
          }
        }
        for (const check of row?.checks ?? []) {
          const expected = SUMMARY_CHECKS[check]?.(plan)
          if (!SUMMARY_CHECKS[check]) {
            fail(`${where}/${lang}.summary[${index}]: 知らない checks「${check}」`)
          } else if (expected === undefined || expected === null) {
            fail(`${where}/${lang}.summary[${index}]: products.js に ${check} が無い`)
          } else if (!containsValue(String(row.detail), expected)) {
            fail(`${where}/${lang}.summary[${index}]: 「${row.term}」に ${check} の値（${expected}）が書かれていない`)
          } else {
            covered.add(check)
          }
        }
      })
      // products.js にある値は、どこかの行で必ず示す。書き漏らすと価格や期間を変えたときに文言が置き去りになる
      if (needsSummary) {
        for (const check of Object.keys(SUMMARY_CHECKS)) {
          const value = SUMMARY_CHECKS[check](plan)
          if (value !== undefined && value !== null && !covered.has(check)) {
            fail(`${where}: ${lang} の summary に、${check} を示す行（checks: ["${check}"]）が無い`)
          }
        }
      }

      // Stripe の metadata に収まること。ここが超えると記録が切れる
      const metadata = toConsentMetadata({ items, summary }, normalizeLang(lang))
      const keys = Object.keys(metadata)
      if (keys.length + OTHER_METADATA_KEYS > METADATA_KEY_COUNT_LIMIT) {
        fail(`${where}/${lang}: metadata のキー数が多すぎる（${keys.length} + ${OTHER_METADATA_KEYS}）`)
      }
      for (const [key, value] of Object.entries(metadata)) {
        if (key.length > METADATA_KEY_LIMIT) fail(`${where}/${lang}: metadata のキーが長い（${key}）`)
        if (value.length > METADATA_VALUE_LIMIT) fail(`${where}/${lang}: metadata の値が 500 文字を超える（${key}）`)
      }
      // 文言が切られていないこと。切られる長さなら実文を見直す
      items.forEach((item, index) => {
        if (String(item?.label ?? '').length > METADATA_VALUE_LIMIT) {
          fail(`${where}/${lang}.items[${index}]: label が 500 文字を超えるため記録時に切られる`)
        }
      })
      summary.forEach((row, index) => {
        if (toSummaryText(row).length > METADATA_VALUE_LIMIT) {
          fail(`${where}/${lang}.summary[${index}]: 見出しと本文が 500 文字を超えるため記録時に切られる`)
        }
      })
    }

    // 日英で数が違うと、どちらかの言語だけ項目や条件が欠ける
    for (const part of ['items', 'summary']) {
      const ja = set.ja?.[part] ?? []
      const en = set.en?.[part] ?? []
      if (ja.length !== en.length) fail(`${where}: 日英で ${part} の数が違う（ja ${ja.length} / en ${en.length}）`)
    }

    // 同意した法務文書の版を consentVersion から引けるようにする。
    // リンク先の改定日（<time data-revised>）より版が古ければ、改定して版を上げ忘れている（SPEC §8.3）
    const versionDate = String(plan.consentVersion ?? '').slice(0, 10)
    for (const target of linkedFiles) {
      const revised = readFileSync(target, 'utf8').match(/<time\b[^>]*\bdata-revised\b[^>]*\bdatetime="([^"]+)"/)
      if (!revised) {
        fail(`${where}: リンク先 ${target.slice(PUBLIC_DIR.length)} に改定日の印（<time data-revised datetime>）が無い`)
      } else if (versionDate < revised[1]) {
        fail(`${where}: consentVersion（${plan.consentVersion}）がリンク先の改定日（${revised[1]}・${target.slice(PUBLIC_DIR.length)}）より前。版を上げる`)
      }
    }
  }
}

console.log(`  ${checkedPlans} プラン分を確認した`)

console.log('')
console.log('== ページの data-consent-version ==')

// /api/checkout は送られてきた版が products.js と違えば 409 で止める。
// ページ側の書き換え忘れは、本番で購入できなくなるまで気づけないため、ここで止める
let checkedButtons = 0
for (const file of listHtml(PUBLIC_DIR)) {
  const html = readFileSync(file, 'utf8')
  for (const tag of html.match(/<[a-z]+\b[^>]*\bdata-consent-version="[^"]*"[^>]*>/gi) ?? []) {
    checkedButtons += 1
    const attr = (name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
    const where = `${file.slice(PUBLIC_DIR.length)} の ${attr('data-product')}/${attr('data-plan')}`
    const resolved = resolvePlan(attr('data-product'), attr('data-plan'))
    if (!resolved) {
      fail(`${where}: products.js に無いプロダクト・プラン`)
    } else if (attr('data-consent-version') !== resolved.plan.consentVersion) {
      fail(`${where}: data-consent-version が ${attr('data-consent-version')}（products.js は ${resolved.plan.consentVersion}）`)
    } else if (attr('data-consent-set') !== resolved.plan.consentSet) {
      fail(`${where}: data-consent-set が ${attr('data-consent-set')}（products.js は ${resolved.plan.consentSet}）`)
    }
  }
}
console.log(`  ${checkedButtons} 個のボタンを確認した`)

console.log('')
console.log(hasFailure ? '同意ダイアログの文言に問題がある。' : '同意ダイアログの文言は記録できる状態にある。')
process.exit(hasFailure ? 1 : 0)
