// 同意ダイアログの文言と、その記録経路を確認する（SPEC §8.3 / §8.4）。
//
// 文言の出どころは public/products/<slug>/assets/consent-items.json だけである。
// ブラウザのダイアログと、決済時の Stripe への記録が、同じファイルを読む。
// ここが崩れると「版番号は残るが文言が残らない決済」が生まれるため、機械で確かめる。
//
// 見るもの:
//   - セットの形（言語ごとの entries。同意する行は consent を持つ）と、日英の並びの一致
//   - 同意する行のリンク先が実在すること
//   - 購入の条件の行に products.js の値（価格・期間）がそのまま書かれていること
//   - Stripe の metadata の上限に収まること
//   - ページの data-consent-version が products.js と一致すること（食い違うと /api/checkout が 409 で止める）
//   - consentVersion が、同意する行のリンク先の法務文書の改定日より前でないこと（改定して版を上げ忘れるのを止める）
//
// 依存を持ち込まないため、ランナーに同梱の Node だけで動かす。
//
//   node tests/check-consent.mjs

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PRODUCTS, resolvePlan } from '../functions/lib/products.js'
import { normalizeLang, toConsentMetadata, toEntryText } from '../functions/lib/consent.js'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const PUBLIC_DIR = join(ROOT, 'public')

// Stripe の制限（SPEC §8.4）
const METADATA_KEY_LIMIT = 40
const METADATA_VALUE_LIMIT = 500
const METADATA_KEY_COUNT_LIMIT = 50
// 決済側が他に入れるキー: consent_version / consent_at / product / plan / consent_at_client
const OTHER_METADATA_KEYS = 5

const LANGS = ['ja', 'en']

// 行の checks に書ける印と、その行に書かれているべき文字列
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

    // 有償プランは購入の条件（価格・期間）を本文として出す。無料版は同意の行だけでよい
    const isPaid = plan.billing !== 'free'
    const linkedFiles = new Set()

    for (const lang of LANGS) {
      const entries = set[lang]?.entries
      if (!Array.isArray(entries) || entries.length === 0) {
        fail(`${where}: ${lang} の entries が無い`)
        continue
      }
      if (!entries.some((entry) => entry?.consent)) {
        fail(`${where}: ${lang} に同意する行（consent）が1つも無い`)
      }

      const covered = new Set()
      entries.forEach((entry, index) => {
        const at = `${where}/${lang}.entries[${index}]`
        if (typeof entry?.term !== 'string' || entry.term.length === 0) fail(`${at}: term が無い`)
        if (isPaid && (typeof entry?.detail !== 'string' || entry.detail.length === 0)) fail(`${at}: detail が無い`)

        // 同意する行は、チェックボックスの文言とリンクを持つ。リンク先は実在し、フラグメントの id まであること
        if (entry?.consent) {
          for (const key of ['label', 'linkText', 'href']) {
            if (typeof entry.consent[key] !== 'string' || entry.consent[key].length === 0) {
              fail(`${at}: consent.${key} が無い`)
            }
          }
          const href = entry.consent.href
          if (typeof href === 'string' && href.startsWith('/')) {
            const [path, fragment] = href.split('#')
            const target = toPublicFile(path)
            if (!target) {
              fail(`${at}: リンク先が無い（${href}）`)
            } else {
              linkedFiles.add(target)
              if (fragment && !readFileSync(target, 'utf8').includes(`id="${fragment}"`)) {
                fail(`${at}: リンク先に id="${fragment}" が無い（${href}）`)
              }
            }
          }
        }

        for (const check of entry?.checks ?? []) {
          const expected = SUMMARY_CHECKS[check]?.(plan)
          if (!SUMMARY_CHECKS[check]) {
            fail(`${at}: 知らない checks「${check}」`)
          } else if (expected === undefined || expected === null) {
            fail(`${at}: products.js に ${check} が無い`)
          } else if (!containsValue(String(entry.detail), expected)) {
            fail(`${at}: 「${entry.term}」に ${check} の値（${expected}）が書かれていない`)
          } else {
            covered.add(check)
          }
        }

        // 文言が切られていないこと。切られる長さなら実文を見直す
        if (toEntryText(entry).length > METADATA_VALUE_LIMIT) {
          fail(`${at}: 見出し・本文・チェックの文言が 500 文字を超えるため記録時に切られる`)
        }
      })

      // products.js にある値は、どこかの行で必ず示す。書き漏らすと価格や期間を変えたときに文言が置き去りになる
      if (isPaid) {
        for (const check of Object.keys(SUMMARY_CHECKS)) {
          const value = SUMMARY_CHECKS[check](plan)
          if (value !== undefined && value !== null && !covered.has(check)) {
            fail(`${where}: ${lang} に、${check} を示す行（checks: ["${check}"]）が無い`)
          }
        }
      }

      // Stripe の metadata に収まること。ここが超えると記録が切れる
      const metadata = toConsentMetadata(entries, normalizeLang(lang))
      const keys = Object.keys(metadata)
      if (keys.length + OTHER_METADATA_KEYS > METADATA_KEY_COUNT_LIMIT) {
        fail(`${where}/${lang}: metadata のキー数が多すぎる（${keys.length} + ${OTHER_METADATA_KEYS}）`)
      }
      for (const [key, value] of Object.entries(metadata)) {
        if (key.length > METADATA_KEY_LIMIT) fail(`${where}/${lang}: metadata のキーが長い（${key}）`)
        if (value.length > METADATA_VALUE_LIMIT) fail(`${where}/${lang}: metadata の値が 500 文字を超える（${key}）`)
      }
    }

    // 日英で行と同意の並びが違うと、どちらかの言語だけ条件や同意が欠ける
    const shape = (lang) => (set[lang]?.entries ?? []).map((entry) => (entry?.consent ? 'C' : '-')).join('')
    if (shape('ja') !== shape('en')) {
      fail(`${where}: 日英で行の数か、同意する行の位置が違う（ja ${shape('ja')} / en ${shape('en')}）`)
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
