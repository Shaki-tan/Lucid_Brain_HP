// プロダクト × プランのレジストリ。プロダクト固有の「値」はここだけに書く（SPEC §8.2）。
// ハンドラ側に金額・配布ファイル・遷移先を直書きしない。
//
// プロダクト追加時に触るのは次の6つ（SPEC §8.2）。
//   1. このファイルに1エントリ
//   2. public/assets/js/partials.js の PRODUCTS に表示名（ヘッダーのロゴタイプ・SPEC §5.2）
//   3. public/products/<name>/ と public/en/products/<name>/（legal/ の利用規約を含む）
//   4. public/products/<name>/assets/consent-items.json（有償プランがある場合・SPEC §8.3）
//   5. public/docs/<name>/            （SPEC §4.3 の例外。作り忘れやすい）
//   6. public/legal/tokushoho.html（と英語版）に商品の販売条件の節（SPEC §2.2）
// そのあと public/sitemap.xml に日英の全URLを足す。

// Pawgress のダウンロード期間と重複決済の期間（時間）。規約が2つを揃えて定めているため、いまは同じ値を入れる。
// 分けるときは規約の改定と同時に行い、paid プランの片方のキーの値を変えるだけでよい（SPEC §8.2）。
// 読む側は必ず自分の用途のキーを読む。
//   downloadWindowHours  — 決済の完了から、決済完了ページの URL でダウンロードできる時間（functions/lib/entitlement.js）
//   duplicateWindowHours — 先の決済からこの時間内に重ねて決済したものを重複とみなす（同意の表示・重複決済の検出）
const PAWGRESS_WINDOW_HOURS = 72

export const PRODUCTS = {
  pawgress: {
    displayName: 'Pawgress',
    // Stripe の商品名と説明文。Stripe Checkout（申込みが確定する画面）と請求書に出る（SPEC §7.6）。
    // scripts/ops.mjs stripe がこの値に揃える。ダッシュボードで変えても次の stripe で戻る。
    // Stripe は商品ごとに1言語しか持てないので日本語だけで書く。分量は「1点」で示し、「1ライセンス」とは書かない
    stripeProductName: 'Pawgress 有償版（Windows 用・買い切り・1点）',
    stripeProductDescription: '【仮】決済完了後ただちにダウンロード（72時間）。決済完了後の返金不可（重大な不具合を除く）。',
    successPath: '/products/pawgress/thanks',
    cancelPath: '/products/pawgress/#price',
    plans: {
      free: {
        billing: 'free',
        // 配布ファイル名の型。{version} はアップロード時にファイル名から読み取る。
        // R2 のキーはここから組む（functions/lib/releases.js・SPEC §8.5）。
        releaseFile: 'Pawgress-Free-Windows-{version}-Setup.exe',
      },
      paid: {
        billing: 'one_time',
        checkoutMode: 'payment',
        // Stripe に Price を作るときの値。Worker は読まず、scripts/ops.mjs stripe だけが読む。
        // LP の表示価格（日英）と一致させる。変えて stripe を流すと新しい Price が作られ、
        // secret STRIPE_PRICES も差し替わる。Stripe の Price は金額を後から変えられないため。
        unitAmount: 2980,
        currency: 'jpy',
        releaseFile: 'Pawgress-Windows-{version}-Setup.exe',
        downloadWindowHours: PAWGRESS_WINDOW_HOURS,
        duplicateWindowHours: PAWGRESS_WINDOW_HOURS,
        consentSet: 'one_time',
        consentVersion: '2026-10-15.2',
      },
      // サブスクを足す場合の形（現時点では定義しない・SPEC §8.2）。
      // pro: {
      //   billing: 'subscription',
      //   checkoutMode: 'subscription',
      //   consentSet: 'subscription',
      //   consentVersion: '2026-10-15',
      //   hasPortal: true,
      // },
    },
  },
}

// successPath / cancelPath は日本語のページを指す。英語のページは同じ階層を /en/ の下に持つ（SPEC §2.1）。
// 購入やダウンロードを始めたページの言語に戻すため、パスはこれを通して組む
export function toLangPath(path, lang) {
  return lang === 'en' ? `/en${path}` : path
}

// レジストリに無い組み合わせは null を返す。呼び出し側は 400 にする。
export function resolvePlan(productId, planId) {
  if (typeof productId !== 'string' || typeof planId !== 'string') return null

  const product = Object.prototype.hasOwnProperty.call(PRODUCTS, productId)
    ? PRODUCTS[productId]
    : null
  if (!product) return null

  const plan = Object.prototype.hasOwnProperty.call(product.plans, planId)
    ? product.plans[planId]
    : null
  if (!plan) return null

  return { productId, planId, product, plan }
}
