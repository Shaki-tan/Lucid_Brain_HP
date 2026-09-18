// GET /api/download?session_id=xxx&product=pawgress&plan=paid
//
// Checkout Session ID をそのまま認可情報として扱い、リクエストの都度 Stripe API へ照会する。
// 独自の有効期限・ワンタイム制御は設けない（SPEC §8.1）。
//
// 受け入れるリスク: session_id を知る第三者はダウンロードできる。
// 独自トークン・期限・認証を持たない方針とのトレードオフであり、設計上の受容である（SPEC §7.5）。

import { resolvePlan } from '../lib/products.js'
import { checkEntitlement } from '../lib/entitlement.js'
import { streamObject } from '../lib/r2.js'
import { text } from '../lib/http.js'
import { logError, logInfo, sessionTail } from '../lib/log.js'

// 既定値はプロダクト追加前に発行済みの thanks URL（?session_id= のみ）を生かすためにある。
const DEFAULT_PRODUCT = 'pawgress'
const DEFAULT_PLAN = 'paid'

export async function onRequestGet(context) {
  const { request, env } = context
  const url = new URL(request.url)

  const sessionId = url.searchParams.get('session_id')
  const productId = url.searchParams.get('product') || DEFAULT_PRODUCT
  const planId = url.searchParams.get('plan') || DEFAULT_PLAN

  if (!sessionId) {
    return text('Missing session_id', 400)
  }

  const resolved = resolvePlan(productId, planId)
  if (!resolved || resolved.plan.billing === 'free') {
    return text('Unknown product or plan', 400)
  }
  const { plan } = resolved

  if (!env.STRIPE_SECRET_KEY || !env.RELEASES) {
    logError('download_not_configured', { product: productId, plan: planId })
    return text('Server not configured', 500)
  }

  const entitlement = await checkEntitlement(env, plan, sessionId)
  if (!entitlement.isEntitled) {
    logInfo('download_denied', {
      product: productId,
      plan: planId,
      session_tail: sessionTail(sessionId),
      reason: entitlement.reason,
    })
    return text('Not entitled', 403)
  }

  const response = await streamObject(env.RELEASES, plan.r2Key, plan.downloadName)
  if (!response) {
    // R2 のキーとレジストリがずれている。再構築手順の対象（SPEC §7.5）。
    logError('download_object_missing', { product: productId, plan: planId, r2_key: plan.r2Key })
    return text('File not found', 404)
  }

  logInfo('download_ok', {
    product: productId,
    plan: planId,
    session_tail: sessionTail(sessionId),
    reason: entitlement.reason,
  })
  return response
}
