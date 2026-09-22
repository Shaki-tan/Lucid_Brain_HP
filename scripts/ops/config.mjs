// リポジトリ内の設定を読む。値をここで新たに持たず、wrangler.jsonc と products.js から引く。

import { readFileSync } from 'node:fs'
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
    // 割り当てているホスト名（custom_domain）。www の転送の確認に使う
    hosts: (section.routes ?? []).map((route) => route.pattern),
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

// 環境ごとに、デプロイ元のブランチ。GitHub 連携のビルド設定（ダッシュボード）と一致させる（SPEC §7.7）。
// 手元から deploy するときに、別の環境のコードを出してしまわないための照合に使う。
export function toDeployBranch(envName) {
  return envName ? { staging: 'develop' }[envName] : 'main'
}

// 本番を公開したか。公開するまでは本番もテスト環境と同じく Cloudflare Access の内側に置く（SPEC §7.7）。
// 公開するときにダッシュボードで本番の Access を外し、ここを true にする。status と smoke はこの値で確認内容を変える。
export const IS_LAUNCHED = false

// その環境が Access の内側にあるべきか。テスト環境は常に内側
export function isBehindAccess(envName) {
  return envName ? true : !IS_LAUNCHED
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
