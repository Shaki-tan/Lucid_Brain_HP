// GET /api/download?session_id=xxx&product=pawgress&plan=paid&lang=ja
//
// Checkout Session ID をそのまま認可情報として扱い、リクエストの都度 Stripe API へ照会する。
// 許可するのは決済の完了から plan.downloadWindowHours の間だけで、全額返金した決済は拒否する。
// 判定は functions/lib/entitlement.js に閉じる。回数の制御とワンタイム化はしない（SPEC §8.1）。
//
// 受け入れるリスク: 期間内は、session_id を知る第三者もダウンロードできる。
// 独自トークン・認証を持たない方針とのトレードオフであり、設計上の受容である（SPEC §7.5）。
//
// 失敗したとき、ページ遷移として要求されていれば決済完了ページのエラーパネルへ戻す。
// 素のテキストでは、購入者に何が起きたかも窓口も伝わらないためである（SPEC §8.1）。
// fetch や curl からの要求には、これまでどおりテキストで返す。

import { resolvePlan, toLangPath } from '../lib/products.js'
import { checkEntitlement } from '../lib/entitlement.js'
import { streamObject } from '../lib/r2.js'
import { toLatestFileName, toLatestKey } from '../lib/releases.js'
import { isNavigation, redirect, text } from '../lib/http.js'
import { logError, logInfo, sessionTail } from '../lib/log.js'

// 判定の理由を、決済完了ページのエラーパネルの種別に寄せる。
// 購入者にとって案内が同じになるものは1つにまとめる（thanks.js の種別と一致させる）
const ERROR_BY_REASON = {
  session_not_found: 'not_found',
  payment_not_completed: 'not_found',
  charge_not_found: 'not_found',
  refunded: 'refunded',
  expired: 'expired',
  window_not_configured: 'server',
}

// 決済完了ページのエラーパネルへ戻す。session_id は付けない。
// 付けると決済完了ページが自動でダウンロードを始め、エラー → 戻る → ダウンロード、を繰り返す
function toThanksError(product, lang, error) {
  return redirect(`${toLangPath(product.successPath, lang)}?error=${error}`)
}

export async function onRequestGet(context) {
  const { request, env } = context
  const url = new URL(request.url)

  const sessionId = url.searchParams.get('session_id')
  // 既定値を持たない。プロダクトが増えたとき、省略された URL に別の製品を配らないため
  const productId = url.searchParams.get('product')
  const planId = url.searchParams.get('plan')
  const lang = url.searchParams.get('lang')

  // 戻り先は product.successPath から組むので、プロダクトを先に解決する。
  // 分からなければ戻り先も無いため、テキストで返す
  const resolved = resolvePlan(productId, planId)
  if (!resolved || resolved.plan.billing === 'free') {
    return text('Unknown product or plan', 400)
  }
  const { product, plan } = resolved

  // ページ遷移ならエラーパネルへ、そうでなければテキストで返す
  const fail = (error, body, status) =>
    isNavigation(request) ? toThanksError(product, lang, error) : text(body, status)

  if (!sessionId) {
    return fail('missing', 'Missing session_id', 400)
  }

  if (!env.STRIPE_SECRET_KEY || !env.RELEASES) {
    logError('download_not_configured', { product: productId, plan: planId })
    return fail('server', 'Server not configured', 500)
  }

  const entitlement = await checkEntitlement(env, plan, sessionId)
  if (!entitlement.isEntitled) {
    logInfo('download_denied', {
      product: productId,
      plan: planId,
      session_tail: sessionTail(sessionId),
      reason: entitlement.reason,
    })
    return fail(ERROR_BY_REASON[entitlement.reason] ?? 'not_found', 'Not entitled', 403)
  }

  const key = toLatestKey(productId, plan)
  const response = await streamObject(env.RELEASES, key, toLatestFileName(plan))
  if (!response) {
    // exe が置かれていない。scripts/ops.mjs upload で置く（SPEC §8.5）。
    logError('download_object_missing', { product: productId, plan: planId, r2_key: key })
    return fail('file', 'File not found', 404)
  }

  logInfo('download_ok', {
    product: productId,
    plan: planId,
    session_tail: sessionTail(sessionId),
    reason: entitlement.reason,
  })
  return response
}
