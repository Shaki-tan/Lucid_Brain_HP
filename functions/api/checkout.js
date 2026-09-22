// POST /api/checkout
//
// Stripe Checkout Session を作成し、遷移先URLを返す。
// 金額はクライアントから受け取らない。プロダクト×プランをレジストリで解決し、
// secret STRIPE_PRICES から Price ID を引く（SPEC §8.2）。
//
// 同意の事実は Stripe の metadata に残す。Workers Logs には残さない（SPEC §8.4）。

import { resolvePlan } from '../lib/products.js'
import { ConsentItemsError, normalizeLang, readConsentItems, toConsentMetadata } from '../lib/consent.js'
import { isBlockedRegion } from '../lib/regions.js'
import { createCheckoutSession, getPriceId, StripeError } from '../lib/stripe.js'
import { error, isSameOrigin, json } from '../lib/http.js'
import { logError } from '../lib/log.js'

export async function onRequestPost(context) {
  const { request, env } = context

  // 濫用対策。自サイト以外からの呼び出しを拒否する（SPEC §7.5）。
  if (!isSameOrigin(request)) {
    return error('forbidden_origin', 403)
  }

  // 販売しない地域を弾く（SPEC §7.2 / §8.1）。
  // 451 Unavailable For Legal Reasons を返し、LP 側でも同じ判定でボタンを無効化する。
  const country = request.cf?.country
  if (isBlockedRegion(country)) {
    return error('unavailable_in_region', 451)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return error('invalid_request', 400)
  }

  const resolved = resolvePlan(body?.product, body?.plan)
  if (!resolved) {
    return error('unknown_product_or_plan', 400)
  }
  const { productId, planId, product, plan } = resolved

  // 無料版は決済を経由しない。/api/download-free を使う。
  if (plan.billing === 'free') {
    return error('plan_not_purchasable', 400)
  }

  // 同意の版が一致しない場合は、古いページが開かれたままになっている。
  // その版に同意したという記録が実際の文言とずれるため、決済に進ませない。
  if (body?.consentVersion !== plan.consentVersion) {
    return error('consent_version_mismatch', 409)
  }

  const priceId = getPriceId(env, productId, planId)
  if (!env.STRIPE_SECRET_KEY || !priceId) {
    logError('checkout_not_configured', { product: productId, plan: planId })
    return error('server_not_configured', 500)
  }

  // ドメイン確定まで *.workers.dev を前提にする。確定後は SITE_BASE_URL を入れるだけでよい（SPEC §3）。
  const baseUrl = (env.SITE_BASE_URL || new URL(request.url).origin).replace(/\/$/, '')

  // 時刻はサーバ側で採る（SPEC §8.4 原則4）。
  const consentAt = new Date().toISOString()

  // 同意した文言そのものを、配信中のアセットから読む（SPEC §8.4 原則6）。
  // クライアントから文言を受け取らない。受け取ると「購入者が申告した文言」が記録される。
  //
  // 読めない場合は決済を通さない。版番号だけが残って文言が残らない決済を作らないためである。
  // ASSETS への参照は Worker 内で完結するため、ここが失敗するのはデプロイの不整合に限られる。
  const consentLang = normalizeLang(body?.consentLang)
  let consentItems
  try {
    consentItems = await readConsentItems(env, baseUrl, productId, plan.consentSet, consentLang)
  } catch (cause) {
    if (!(cause instanceof ConsentItemsError)) throw cause
    logError('consent_items_unavailable', {
      product: productId,
      plan: planId,
      consentSet: plan.consentSet,
      reason: cause.message,
    })
    return error('server_not_configured', 500)
  }

  const params = new URLSearchParams()
  params.set('mode', plan.checkoutMode)
  params.set('line_items[0][price]', priceId)
  params.set('line_items[0][quantity]', '1')
  params.append('payment_method_types[]', 'card')
  params.set('success_url', `${baseUrl}${product.successPath}?session_id={CHECKOUT_SESSION_ID}`)
  params.set('cancel_url', `${baseUrl}${product.cancelPath}`)

  // 一覧画面で何の決済かを判別できるようにする（SPEC §8.4）。
  params.set('client_reference_id', `${productId}:${planId}`)

  // Session の metadata だけではダッシュボードの「支払い」詳細に出てこないため、
  // 支払い側（PaymentIntent / Subscription）にも同じ値を書く（SPEC §8.4）。
  const metadata = {
    consent_version: plan.consentVersion,
    consent_at: consentAt,
    product: productId,
    plan: planId,
    // 版番号だけでは、後からその版の文言を示せない（SPEC §8.4 原則6）。
    ...toConsentMetadata(consentItems, consentLang),
  }
  // クライアントが申告した時刻は参考値として別キーに入れる。改竄可能なため判断には使わない。
  if (typeof body?.consentAtClient === 'string') {
    metadata.consent_at_client = body.consentAtClient.slice(0, 500)
  }

  const payloadPrefix = plan.checkoutMode === 'subscription' ? 'subscription_data' : 'payment_intent_data'
  for (const [key, value] of Object.entries(metadata)) {
    params.set(`metadata[${key}]`, value)
    params.set(`${payloadPrefix}[metadata][${key}]`, value)
  }

  // 正式な Invoice を自動発行し、購入者にメール送信する（Stripe 側の別途課金あり: 取引額の0.4%・上限$2）。
  // 前提: Stripe ダッシュボード Settings > Emails > Successful payments を有効化しておくこと。
  // 不要と判断した場合はこの1行をコメントアウトするだけで無効化できる（環境変数は使わない方針）。
  if (plan.checkoutMode === 'payment') {
    params.set('invoice_creation[enabled]', 'true')
  }

  try {
    const session = await createCheckoutSession(env, params)
    return json({ url: session.url })
  } catch (err) {
    // Checkout 作成の失敗は障害調査の対象。Workers Logs に残す（SPEC §8.4）。
    logError('checkout_session_failed', {
      product: productId,
      plan: planId,
      stripe_status: err instanceof StripeError ? err.status : null,
    })
    return error('checkout_session_failed', 502)
  }
}
