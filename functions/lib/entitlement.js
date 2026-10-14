// ダウンロード可否の判定。買い切りとサブスクの差はこのファイルだけに閉じる（SPEC §8.2）。
//
// Checkout Session ID をそのまま認可情報として扱い、リクエストの都度 Stripe API へ照会する。
// 買い切りは、決済の完了（Charge の作成時刻）から plan.downloadWindowHours の間だけ許可し、
// 全額返金した決済は拒否する（SPEC §8.1）。
// 独自のトークン発行・署名を持たず、状態も保存しない。期間は Stripe が持つ決済の時刻から毎回求める。
// 時間で劣化するものを置かない方針（SPEC §1.2）と整合している。

import { retrieveCheckoutSession } from './stripe.js'

// サブスクが「使える」とみなす状態。
// past_due を含めないのは、支払いが滞った状態でのダウンロードを許さないためである。
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing'])

// 決済の時刻を得るために展開する。照会は1回のまま（SPEC §8.1）
const ONE_TIME_EXPAND = ['payment_intent.latest_charge']

const SECONDS_PER_HOUR = 3600

// ダウンロードできる期間（秒）。テスト環境だけ wrangler.jsonc の env.staging.vars で短くできる。
// 本番の vars に置かないことは tests/check-wrangler.mjs が検査する。
function toDownloadWindowSeconds(env, plan) {
  const override = Number(env.DOWNLOAD_WINDOW_SECONDS)
  if (Number.isInteger(override) && override > 0) return override
  return plan.downloadWindowHours * SECONDS_PER_HOUR
}

// 判定結果は { isEntitled, reason } で返す。reason はログとレスポンスの出し分けに使う。
// now は検査で時刻を固定するために受ける（tests/check-entitlement.mjs）。
export async function checkEntitlement(env, plan, sessionId, now = Date.now()) {
  if (plan.billing === 'free') {
    return { isEntitled: true, reason: 'free' }
  }

  const needsSubscription = plan.billing === 'subscription'

  let session
  try {
    session = await retrieveCheckoutSession(env, sessionId, needsSubscription ? ['subscription'] : ONE_TIME_EXPAND)
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

  // 展開できていなければ決済の時刻が分からない。期間を判定できないまま許可しない
  const charge = session.payment_intent?.latest_charge
  if (!charge || typeof charge !== 'object') {
    return { isEntitled: false, reason: 'charge_not_found' }
  }

  // 全額返金だけを拒否する。部分返金は判定に使わない（SPEC §8.1）
  if (charge.refunded === true) {
    return { isEntitled: false, reason: 'refunded' }
  }

  // 期間の値が無いと「いつまでも許可」に転ぶ。設定の不備は許可しない側に倒す
  const windowSeconds = toDownloadWindowSeconds(env, plan)
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    return { isEntitled: false, reason: 'window_not_configured' }
  }

  if (now > (charge.created + windowSeconds) * 1000) {
    return { isEntitled: false, reason: 'expired' }
  }
  return { isEntitled: true, reason: 'paid' }
}
