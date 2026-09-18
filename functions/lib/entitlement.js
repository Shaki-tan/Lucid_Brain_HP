// ダウンロード可否の判定。買い切りとサブスクの差はこのファイルだけに閉じる（SPEC §8.2）。
//
// Checkout Session ID をそのまま認可情報として扱い、リクエストの都度 Stripe API へ照会する。
// 独自のトークン発行・署名・有効期限を持たない（SPEC §8.1）。
// 時間で劣化するものを置かない方針（SPEC §1.2）と整合している。

import { retrieveCheckoutSession } from './stripe.js'

// サブスクが「使える」とみなす状態。
// past_due を含めないのは、支払いが滞った状態でのダウンロードを許さないためである。
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing'])

// 判定結果は { isEntitled, reason } で返す。reason はログとレスポンスの出し分けに使う。
export async function checkEntitlement(env, plan, sessionId) {
  if (plan.billing === 'free') {
    return { isEntitled: true, reason: 'free' }
  }

  const needsSubscription = plan.billing === 'subscription'

  let session
  try {
    session = await retrieveCheckoutSession(env, sessionId, needsSubscription ? ['subscription'] : [])
  } catch {
    // 存在しない ID・別アカウントの ID・改竄はすべてここに落ちる。
    return { isEntitled: false, reason: 'session_not_found' }
  }

  if (needsSubscription) {
    const status = session.subscription?.status
    if (!ACTIVE_SUBSCRIPTION_STATUSES.has(status)) {
      return { isEntitled: false, reason: 'subscription_inactive' }
    }
    return { isEntitled: true, reason: 'subscription_active' }
  }

  if (session.payment_status !== 'paid') {
    return { isEntitled: false, reason: 'payment_not_completed' }
  }
  return { isEntitled: true, reason: 'paid' }
}
