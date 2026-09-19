// 同意項目の文言と、その記録経路を確認する（SPEC §8.3 / §8.4）。
//
// 文言の出どころは public/products/<slug>/assets/consent-items.json だけである。
// ブラウザのダイアログと、決済時の Stripe への記録が、同じファイルを読む。
// ここが崩れると「版番号は残るが文言が残らない決済」が生まれるため、機械で確かめる。
//
// 依存を持ち込まないため、ランナーに同梱の Node だけで動かす。
//
//   node tests/check-consent.mjs

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PRODUCTS } from '../functions/lib/products.js'
import { normalizeLang, toConsentMetadata } from '../functions/lib/consent.js'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const PUBLIC_DIR = join(ROOT, 'public')

// Stripe の制限（SPEC §8.4）
const METADATA_KEY_LIMIT = 40
const METADATA_VALUE_LIMIT = 500
const METADATA_KEY_COUNT_LIMIT = 50

let hasFailure = false

function fail(message) {
  console.log(`NG  ${message}`)
  hasFailure = true
}

function itemsPath(productId) {
  return join(PUBLIC_DIR, 'products', productId, 'assets', 'consent-items.json')
}

console.log('== 同意項目の文言 ==')

let checkedPlans = 0

for (const [productId, product] of Object.entries(PRODUCTS)) {
  // 有償プランを持たないプロダクトは同意項目を必要としない
  const paidPlans = Object.entries(product.plans).filter(([, plan]) => plan.consentSet)
  if (paidPlans.length === 0) continue

  const file = itemsPath(productId)
  if (!existsSync(file)) {
    fail(`${productId}: ${file} が無い。有償プランがあるのに文言のファイルが無い`)
    continue
  }

  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (cause) {
    fail(`${productId}: consent-items.json が JSON として読めない（${cause.message}）`)
    continue
  }

  for (const [planId, plan] of paidPlans) {
    checkedPlans += 1
    const set = data?.sets?.[plan.consentSet]
    if (!set) {
      fail(`${productId}/${planId}: consentSet "${plan.consentSet}" が consent-items.json に無い`)
      continue
    }

    for (const lang of ['ja', 'en']) {
      const items = set[lang]
      if (!Array.isArray(items) || items.length === 0) {
        fail(`${productId}/${planId}: ${lang} の項目が無い`)
        continue
      }

      items.forEach((item, index) => {
        for (const key of ['label', 'linkText', 'href']) {
          if (typeof item?.[key] !== 'string' || item[key].length === 0) {
            fail(`${productId}/${planId}/${lang}[${index}]: ${key} が無い`)
          }
        }
        // リンク先が実在すること。拡張子なしURLは .html に対応づける（check-links.sh と同じ規則）
        if (typeof item?.href === 'string' && item.href.startsWith('/')) {
          const base = join(PUBLIC_DIR, item.href)
          if (!existsSync(base) && !existsSync(`${base}.html`)) {
            fail(`${productId}/${planId}/${lang}[${index}]: リンク先が無い（${item.href}）`)
          }
        }
      })
    }

    // 日英で項目数が違うと、どちらかの言語だけ同意項目が欠ける
    if (Array.isArray(set.ja) && Array.isArray(set.en) && set.ja.length !== set.en.length) {
      fail(`${productId}/${planId}: 日英で項目数が違う（ja ${set.ja.length} / en ${set.en.length}）`)
    }

    // Stripe の metadata に収まること。ここが超えると記録が切れる
    for (const lang of ['ja', 'en']) {
      if (!Array.isArray(set[lang])) continue
      const metadata = toConsentMetadata(set[lang], normalizeLang(lang))
      const keys = Object.keys(metadata)
      // 決済側は他にも consent_version / consent_at / product / plan / consent_at_client を入れる
      if (keys.length + 5 > METADATA_KEY_COUNT_LIMIT) {
        fail(`${productId}/${planId}/${lang}: metadata のキー数が多すぎる（${keys.length} + 5）`)
      }
      for (const [key, value] of Object.entries(metadata)) {
        if (key.length > METADATA_KEY_LIMIT) {
          fail(`${productId}/${planId}/${lang}: metadata のキーが長い（${key}）`)
        }
        if (value.length > METADATA_VALUE_LIMIT) {
          fail(`${productId}/${planId}/${lang}: metadata の値が 500 文字を超える（${key}）`)
        }
      }
      // 文言が切られていないこと。切られる長さなら実文を見直す
      set[lang].forEach((item, index) => {
        if (item.label.length > METADATA_VALUE_LIMIT) {
          fail(`${productId}/${planId}/${lang}[${index}]: label が 500 文字を超えるため記録時に切られる`)
        }
      })
    }
  }
}

console.log(`  ${checkedPlans} プラン分を確認した`)

console.log('')
console.log(hasFailure ? '同意項目に問題がある。' : '同意項目は記録できる状態にある。')
process.exit(hasFailure ? 1 : 0)
