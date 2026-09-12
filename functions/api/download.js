// GET /api/download?session_id=xxx
// Stripe Checkout SessionのIDを認可情報として扱い、リクエストの都度Stripe APIへ直接照会する。
// 独自の有効期限・ワンタイム制御は設けない（session_id自体の有効性・再照会可能性をStripe側に委ねる）。

export async function onRequestGet(context) {
  const { request, env } = context

  if (!env.STRIPE_SECRET_KEY || !env.RELEASES) {
    return new Response("Server not configured", { status: 500 })
  }

  const url = new URL(request.url)
  const sessionId = url.searchParams.get("session_id")
  if (!sessionId) {
    return new Response("Missing session_id", { status: 400 })
  }

  const stripeRes = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }
  )

  if (!stripeRes.ok) {
    return new Response("Invalid session", { status: 403 })
  }

  const session = await stripeRes.json()
  if (session.payment_status !== "paid") {
    return new Response("Payment not completed", { status: 403 })
  }

  const obj = await env.RELEASES.get("latest/Chronos-Setup.exe")
  if (!obj) {
    return new Response("File not found", { status: 404 })
  }

  return new Response(obj.body, {
    headers: {
      "Content-Disposition": 'attachment; filename="Chronos-Setup.exe"',
      "Content-Type": "application/octet-stream",
    },
  })
}
