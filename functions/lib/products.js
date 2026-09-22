// プロダクト × プランのレジストリ。プロダクト固有の「値」はここだけに書く（SPEC §8.2）。
// ハンドラ側に金額・配布ファイル・遷移先を直書きしない。
//
// プロダクト追加時に触るのは次の5つ（SPEC §8.2）。
//   1. このファイルに1エントリ
//   2. public/assets/js/partials.js の PRODUCTS に表示名（ヘッダーのロゴタイプ・SPEC §5.2）
//   3. public/products/<name>/ と public/en/products/<name>/
//   4. public/products/<name>/assets/consent-items.json（有償プランがある場合・SPEC §8.3）
//   5. public/docs/<name>/            （SPEC §4.3 の例外。作り忘れやすい）
// そのあと public/sitemap.xml に日英の全URLを足す。

export const PRODUCTS = {
  pawgress: {
    displayName: 'Pawgress',
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
        consentSet: 'one_time',
        consentVersion: '2026-09-17',
      },
      // サブスクを足す場合の形（現時点では定義しない・SPEC §8.2）。
      // pro: {
      //   billing: 'subscription',
      //   checkoutMode: 'subscription',
      //   consentSet: 'subscription',
      //   consentVersion: '2026-09-17',
      //   hasPortal: true,
      // },
    },
  },
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
