// ダウンロード可否の判定（functions/lib/entitlement.js）を、Stripe の応答を固定して確かめる（SPEC §8.1）。
//
// 期間と返金の判定は、実機では期間が過ぎるのを待たないと確かめられない。
// fetch を差し替えて Checkout Session の応答と時刻を固定し、各場合の reason を見る。
//
// 依存を持ち込まないため、ランナーに同梱の Node だけで動かす。
//
//   node tests/check-entitlement.mjs

import { checkEntitlement } from '../functions/lib/entitlement.js'
import { PRODUCTS } from '../functions/lib/products.js'

const PLAN = PRODUCTS.pawgress.plans.paid
const ENV = { STRIPE_SECRET_KEY: 'sk_test_dummy' }
const SESSION_ID = 'cs_test_dummy'
const PAID_AT = 1_800_000_000 // Charge の created（秒）
const WINDOW_SECONDS = PLAN.downloadWindowHours * 3600

let hasFailure = false
let requestedUrls = []

function fail(message) {
  console.log(`NG  ${message}`)
  hasFailure = true
}

function toSession({ paymentStatus = 'paid', charge = {} } = {}) {
  return {
    id: SESSION_ID,
    payment_status: paymentStatus,
    payment_intent:
      charge === null ? { id: 'pi_dummy', latest_charge: null } : {
        id: 'pi_dummy',
        latest_charge: { id: 'ch_dummy', created: PAID_AT, refunded: false, amount_refunded: 0, ...charge },
      },
  }
}

// Stripe の応答を固定する。status が 200 以外なら stripe.js は例外を投げる
function stubStripe(body, status = 200) {
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url))
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
}

const atSeconds = (offset) => (PAID_AT + offset) * 1000

const CASES = [
  { name: '支払済み・期間内・返金なし', session: toSession(), now: atSeconds(60), expect: 'paid' },
  { name: '期間のちょうど終わり', session: toSession(), now: atSeconds(WINDOW_SECONDS), expect: 'paid' },
  { name: '期間を1秒過ぎた', session: toSession(), now: atSeconds(WINDOW_SECONDS + 1), expect: 'expired' },
  { name: '全額返金', session: toSession({ charge: { refunded: true, amount_refunded: 2980 } }), now: atSeconds(60), expect: 'refunded' },
  { name: '部分返金・期間内', session: toSession({ charge: { amount_refunded: 1000 } }), now: atSeconds(60), expect: 'paid' },
  { name: '全額返金・期間外（返金を優先）', session: toSession({ charge: { refunded: true } }), now: atSeconds(WINDOW_SECONDS + 1), expect: 'refunded' },
  { name: 'Charge が展開されていない', session: toSession({ charge: null }), now: atSeconds(60), expect: 'charge_not_found' },
  { name: 'Charge が ID のまま', session: { ...toSession(), payment_intent: { latest_charge: 'ch_dummy' } }, now: atSeconds(60), expect: 'charge_not_found' },
  { name: '未払い', session: toSession({ paymentStatus: 'unpaid' }), now: atSeconds(60), expect: 'payment_not_completed' },
  { name: 'Stripe が 404', session: { error: { type: 'invalid_request_error' } }, status: 404, now: atSeconds(60), expect: 'session_not_found' },
  { name: '上書き 180秒・181秒後', session: toSession(), env: { DOWNLOAD_WINDOW_SECONDS: '180' }, now: atSeconds(181), expect: 'expired' },
  { name: '上書き 180秒・180秒後', session: toSession(), env: { DOWNLOAD_WINDOW_SECONDS: '180' }, now: atSeconds(180), expect: 'paid' },
  { name: '上書きが不正な値なら本番の期間', session: toSession(), env: { DOWNLOAD_WINDOW_SECONDS: 'abc' }, now: atSeconds(181), expect: 'paid' },
  { name: '期間の値が無いプラン', session: toSession(), plan: { ...PLAN, downloadWindowHours: undefined }, now: atSeconds(60), expect: 'window_not_configured' },
]

console.log('== ダウンロード可否の判定 ==')

for (const testCase of CASES) {
  requestedUrls = []
  stubStripe(testCase.session, testCase.status ?? 200)
  const env = { ...ENV, ...(testCase.env ?? {}) }
  const { isEntitled, reason } = await checkEntitlement(env, testCase.plan ?? PLAN, SESSION_ID, testCase.now)
  if (reason !== testCase.expect) {
    fail(`${testCase.name}: reason が ${reason}（期待は ${testCase.expect}）`)
  } else if (isEntitled !== (testCase.expect === 'paid')) {
    fail(`${testCase.name}: isEntitled が ${isEntitled}`)
  } else {
    console.log(`OK  ${testCase.name}: ${reason}`)
  }
}

// 照会は1回で、決済の時刻を得るための展開が付いていること
requestedUrls = []
stubStripe(toSession())
await checkEntitlement(ENV, PLAN, SESSION_ID, atSeconds(60))
const expandParam = encodeURIComponent('expand[0]') + '=' + encodeURIComponent('payment_intent.latest_charge')
if (requestedUrls.length !== 1) {
  fail(`Stripe への照会が ${requestedUrls.length} 回（期待は1回）`)
} else if (!requestedUrls[0].includes(expandParam)) {
  fail(`照会に payment_intent.latest_charge の展開が無い（${requestedUrls[0]}）`)
} else {
  console.log('OK  照会は1回で、payment_intent.latest_charge を展開している')
}

console.log('')
console.log(hasFailure ? 'ダウンロード可否の判定に問題がある。' : 'ダウンロード可否の判定は期待どおり。')
process.exit(hasFailure ? 1 : 0)
