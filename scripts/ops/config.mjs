// リポジトリ内の設定を読む。値をここで新たに持たず、wrangler.jsonc と products.js から引く。

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRODUCTS } from '../../functions/lib/products.js'

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WRANGLER_CONFIG = join(REPO, 'wrangler.jsonc')

// JSONC からコメントと末尾カンマを落とす。文字列の中の `//`（URL）は残す。
function stripJsonc(source) {
  let out = ''
  let isInString = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    const next = source[i + 1]
    if (isInString) {
      out += c
      if (c === '\\') {
        out += next
        i++
      } else if (c === '"') {
        isInString = false
      }
      continue
    }
    if (c === '"') {
      isInString = true
      out += c
    } else if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end < 0 ? source.length : end + 1
    } else {
      out += c
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

export function readConfig() {
  const config = JSON.parse(stripJsonc(readFileSync(WRANGLER_CONFIG, 'utf8')))
  const bucket = (config.r2_buckets ?? []).find((entry) => entry.binding === 'RELEASES')
  return {
    workerName: config.name,
    bucketName: bucket?.bucket_name ?? null,
    baseUrl: (config.vars?.SITE_BASE_URL ?? '').replace(/\/$/, ''),
  }
}

// SITE_BASE_URL の値だけを書き換える。コメントと並びを保つため、JSON として書き戻さない。
export function writeBaseUrl(url) {
  const source = readFileSync(WRANGLER_CONFIG, 'utf8')
  const pattern = /("SITE_BASE_URL"\s*:\s*)"[^"]*"/
  if (!pattern.test(source)) throw new Error('wrangler.jsonc に "SITE_BASE_URL" の行が無い')
  writeFileSync(WRANGLER_CONFIG, source.replace(pattern, `$1"${url}"`))
}

// レジストリの全プランを平たく並べる
export function listPlans() {
  return Object.entries(PRODUCTS).flatMap(([productId, product]) =>
    Object.entries(product.plans).map(([planId, plan]) => ({ productId, planId, product, plan })),
  )
}

// Stripe で売るプラン（Price を持つもの）
export function listPaidPlans() {
  return listPlans().filter(({ plan }) => plan.billing !== 'free')
}

// 配布ファイルを持つプラン
export function listReleasePlans() {
  return listPlans().filter(({ plan }) => plan.releaseFile)
}

// Worker が必要とする secret の名前。プロダクトが増えても増えない（価格IDは STRIPE_PRICES に JSON でまとめる）
export const REQUIRED_SECRETS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICES']
