// wrangler.jsonc と products.js の、デプロイしてはいけない組み合わせを止める（SPEC §7.5 / §8.1）。
//
// ダウンロードできる期間は products.js の downloadWindowHours が本番の値で、
// テスト環境だけ env.staging.vars の DOWNLOAD_WINDOW_SECONDS で短くする。
// 短い値のまま本番に出ると、購入者が期間内にダウンロードできず、引渡しができない。
// 手順で防ぐのではなく、デプロイの関門で止める。
//
// 依存を持ち込まないため、ランナーに同梱の Node だけで動かす。
//
//   node tests/check-wrangler.mjs

import { PRODUCTS } from '../functions/lib/products.js'
import { readRawConfig } from '../scripts/ops/config.mjs'

const WINDOW_OVERRIDE = 'DOWNLOAD_WINDOW_SECONDS'

let hasFailure = false

function fail(message) {
  console.log(`NG  ${message}`)
  hasFailure = true
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

const config = readRawConfig()

console.log('== ダウンロード期間の上書き ==')

if (config.vars && Object.prototype.hasOwnProperty.call(config.vars, WINDOW_OVERRIDE)) {
  fail(`本番（トップレベル）の vars に ${WINDOW_OVERRIDE} がある。検証用の値は env.staging.vars にだけ置く`)
}

for (const [envName, section] of Object.entries(config.env ?? {})) {
  const value = section.vars?.[WINDOW_OVERRIDE]
  if (value === undefined) continue
  // Worker では文字列で届く。entitlement.js と同じ読み方で、正の整数として読めること
  if (!isPositiveInteger(Number(value))) {
    fail(`env.${envName}.vars の ${WINDOW_OVERRIDE} が正の整数ではない（${JSON.stringify(value)}）`)
  }
}

console.log('== 有償プランの期間 ==')

let checkedPlans = 0
for (const [productId, product] of Object.entries(PRODUCTS)) {
  for (const [planId, plan] of Object.entries(product.plans)) {
    if (plan.billing !== 'one_time') continue
    checkedPlans += 1
    for (const key of ['downloadWindowHours', 'duplicateWindowHours']) {
      if (!isPositiveInteger(plan[key])) {
        fail(`${productId}/${planId}: ${key} が正の整数ではない（${JSON.stringify(plan[key])}）`)
      }
    }
  }
}
console.log(`  ${checkedPlans} プラン分を確認した`)

console.log('')
console.log(hasFailure ? 'wrangler.jsonc / products.js に問題がある。' : 'wrangler.jsonc / products.js はデプロイできる状態にある。')
process.exit(hasFailure ? 1 : 0)
