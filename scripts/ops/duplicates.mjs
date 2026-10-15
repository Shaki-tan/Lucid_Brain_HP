// 重複決済の検出（SPEC §8.4）。Stripe から読んだ決済を、メールアドレスごとにまとめて突き合わせる。
//
// 規約は「先の決済から duplicateWindowHours 以内に、同じ購入者が有償版を重ねて決済した場合」を重複と定める。
// 購入者は申出を待たずに気づかないことが多いので、当方の側で気づいて返金するために使う。読み取りだけで、返金はしない。
//
// Stripe の呼び出しと切り離してあるのは、まとめ方だけを手元で確かめられるようにするためである。

import { resolvePlan } from '../../functions/lib/products.js'

// Checkout Session を、突き合わせに要る形にする。決済の時刻は SOW-A と同じく Charge の作成時刻を使う
export function toPayment(session) {
  const charge = session.payment_intent?.latest_charge
  if (session.payment_status !== 'paid' || !charge || typeof charge !== 'object') return null
  const email = session.customer_details?.email?.trim().toLowerCase()
  if (!email) return null
  const resolved = resolvePlan(session.metadata?.product, session.metadata?.plan)
  return {
    email,
    productId: resolved?.productId ?? null,
    planId: resolved?.planId ?? null,
    windowHours: resolved?.plan.duplicateWindowHours ?? null,
    paidAt: charge.created,
    amount: session.amount_total,
    currency: session.currency,
    sessionId: session.id,
    paymentIntentId: session.payment_intent?.id ?? null,
    isRefunded: charge.refunded === true,
    amountRefunded: charge.amount_refunded ?? 0,
  }
}

// 同じメールアドレス・同じプランで、前の決済から期間内に重ねて決済したものを組にする。
// 3回以上続いたときは、つながった一連を1つの組にまとめる
export function findDuplicates(payments) {
  const byKey = new Map()
  for (const payment of payments) {
    if (!payment?.windowHours) continue
    const key = `${payment.email}\u0000${payment.productId}\u0000${payment.planId}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(payment)
  }

  const groups = []
  for (const list of byKey.values()) {
    list.sort((a, b) => a.paidAt - b.paidAt)
    let current = [list[0]]
    for (const payment of list.slice(1)) {
      const previous = current[current.length - 1]
      if (payment.paidAt - previous.paidAt <= payment.windowHours * 3600) {
        current.push(payment)
      } else {
        if (current.length > 1) groups.push(current)
        current = [payment]
      }
    }
    if (current.length > 1) groups.push(current)
  }
  return groups.sort((a, b) => a[0].paidAt - b[0].paidAt)
}
