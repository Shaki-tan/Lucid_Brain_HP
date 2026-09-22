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

function readRawConfig() {
  return JSON.parse(stripJsonc(readFileSync(WRANGLER_CONFIG, 'utf8')))
}

// 環境名（null は本番＝トップレベル）ごとの設定。env.<name> の Worker 名は wrangler と同じく <name>-<env> になる
function toEnvConfig(config, envName) {
  const section = envName ? config.env?.[envName] : config
  if (!section) throw new Error(`wrangler.jsonc に env.${envName} が無い`)
  const bucket = (section.r2_buckets ?? []).find((entry) => entry.binding === 'RELEASES')
  return {
    envName,
    workerName: envName ? (section.name ?? `${config.name}-${envName}`) : config.name,
    bucketName: bucket?.bucket_name ?? null,
    baseUrl: (section.vars?.SITE_BASE_URL ?? '').replace(/\/$/, ''),
  }
}

export function readConfig(envName = null) {
  return toEnvConfig(readRawConfig(), envName)
}

// 本番とテストの全環境。Webhook の宛先が「どの環境のものか」を見分けるのに使う
export function readAllConfigs() {
  const config = readRawConfig()
  return [null, ...Object.keys(config.env ?? {})].map((envName) => toEnvConfig(config, envName))
}

// その環境の SITE_BASE_URL の値だけを書き換える。コメントと並びを保つため、JSON として書き戻さない。
// 本番は "env" より前、テストは "<env名>" より後にある最初の SITE_BASE_URL を対象にする。
export function writeBaseUrl(envName, url) {
  const source = readFileSync(WRANGLER_CONFIG, 'utf8')
  const envStart = source.search(/"env"\s*:/)
  const start = envName ? source.indexOf(`"${envName}"`, envStart) : 0
  const end = envName || envStart < 0 ? source.length : envStart
  if (start < 0) throw new Error(`wrangler.jsonc に env.${envName} が無い`)

  const pattern = /("SITE_BASE_URL"\s*:\s*)"[^"]*"/
  const target = source.slice(start, end)
  if (!pattern.test(target)) throw new Error('wrangler.jsonc の該当箇所に "SITE_BASE_URL" の行が無い')
  writeFileSync(WRANGLER_CONFIG, source.slice(0, start) + target.replace(pattern, `$1"${url}"`) + source.slice(end))
}

// 環境ごとに、デプロイ元のブランチ。GitHub 連携のビルド設定（ダッシュボード）と一致させる（SPEC §7.7）。
// 手元から deploy するときに、別の環境のコードを出してしまわないための照合に使う。
export function toDeployBranch(envName) {
  return envName ? { staging: 'develop' }[envName] : 'main'
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
