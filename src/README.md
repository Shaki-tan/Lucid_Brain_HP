# src/

LPのクライアントサイドスクリプトを格納する。

- `i18n.js` — 日本語／英語の翻訳辞書（`i18n.ja` / `i18n.en`）
- `script.js` — 言語切替・スクロール表示などのロジック本体。`i18n.js`のグローバル変数`i18n`に依存するため、`index.html`では`i18n.js`を先に読み込むこと

## 決済バックエンド（Stripe連携）について

有償版の決済処理（Stripe Checkout・Webhook検証）は、検証方式が未確定のためまだ実装していない。実装時はCloudflare Pages Functionsの仕様上、リポジトリ直下の`functions/`ディレクトリに配置する必要がある（Pages Functionsはルート直下の`functions/`をファイルベースルーティングの対象とするため、`src/`配下には置けない）。方針が決まり次第、直下に`functions/api/checkout.js`等を追加する。
