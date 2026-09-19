// Pawgress の同意項目（SPEC §8.3）。
//
// 文言はプロダクトごと、さらにプランごとに変わる。買い切りのソフトと、たとえば継続課金の
// サービスとでは、承諾してもらう内容が別物になる。だから共通の assets/js/consent.js には置かず、
// プロダクトの側に持つ（SPEC §4.1 / §5.2）。
// ダイアログの仕組み（開閉・フォーカス・決済への遷移・地域判定）は共通側が持つ。重複させない。
//
// キーは functions/lib/products.js の plan.consentSet と一致させる。
// 購入ボタンの data-consent-set が、このキーを指す。
//
// 文言を変えたら products.js の consentVersion を上げる。
// 版ごとの文言をどこに残すかは公開前に決める（SPEC §8.4 / §10.1）。現状は git 履歴にしかない。
//
// 読み込みは consent.js より先にする。defer 付きの <script> は記述順に実行される。

window.consentItemSets = {
  // 買い切り（plans.paid.consentSet）
  one_time: {
    // 実文は別途準備中。構造を示す例文である（SPEC §2.4）。
    // 項目は legal 4種と1対1で対応させる。どの項目がどの文書を指すのかを考えさせないため。
    ja: [
      {
        label: '【仮】利用規約の内容を確認しました。',
        linkText: '利用規約',
        href: '/legal/terms',
      },
      {
        label: '【仮】返金ポリシーの内容を確認しました。',
        linkText: '返金ポリシー',
        href: '/legal/refund',
      },
      {
        label: '【仮】プライバシーポリシーの内容を確認しました。',
        linkText: 'プライバシーポリシー',
        href: '/legal/privacy',
      },
      {
        label: '【仮】特定商取引法に基づく表記を確認しました。',
        linkText: '特定商取引法に基づく表記',
        href: '/legal/tokushoho',
      },
    ],
    // 日英とも本文と同等の内容にする。§2.2 の「英語は要約」の唯一の例外である。
    en: [
      {
        label: '[TBD] I have read the Terms of Service.',
        linkText: 'Terms of Service',
        href: '/en/legal/terms',
      },
      {
        label: '[TBD] I have read the Refund Policy.',
        linkText: 'Refund Policy',
        href: '/en/legal/refund',
      },
      {
        label: '[TBD] I have read the Privacy Policy.',
        linkText: 'Privacy Policy',
        href: '/en/legal/privacy',
      },
      {
        label: '[TBD] I have read the Legal Notice under the Act on Specified Commercial Transactions.',
        linkText: 'Legal Notice',
        href: '/en/legal/tokushoho',
      },
    ],
  },

  // 継続課金を入れるときは、ここに subscription のセットを足す（SPEC §8.2 / §8.3）。
  // 内容は導入時に別途指示を受ける。
}
