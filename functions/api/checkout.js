// POST /api/checkout
// Stripe Checkout Sessionを作成し、遷移先URLを返す。
// 金額はクライアントから受け取らず、Stripeダッシュボードで作成したPrice ID（STRIPE_PRICE_ID）を参照する。

export async function onRequestPost(context) {
  const { request, env } = context

  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) {
    return new Response(JSON.stringify({ error: "server_not_configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  const origin = new URL(request.url).origin

  const params = new URLSearchParams()
  params.set("mode", "payment")
  params.set("line_items[0][price]", env.STRIPE_PRICE_ID)
  params.set("line_items[0][quantity]", "1")
  params.append("payment_method_types[]", "card")
  params.set("success_url", `${origin}/thanks.html?session_id={CHECKOUT_SESSION_ID}`)
  params.set("cancel_url", `${origin}/#price`)

  // 正式なInvoiceを自動発行し、購入者にメール送信する（Stripe側の別途課金あり: 取引額の0.4%・上限$2）。
  // 前提: Stripeダッシュボード Settings > Emails > Successful payments を有効化しておくこと。
  // 不要と判断した場合はこの1行をコメントアウトするだけで無効化できる（環境変数は使わない方針）。
  params.set("invoice_creation[enabled]", "true")

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  })

  if (!stripeRes.ok) {
    return new Response(JSON.stringify({ error: "checkout_session_failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    })
  }

  const session = await stripeRes.json()

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}
