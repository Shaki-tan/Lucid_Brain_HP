# src/

LPのクライアントサイドスクリプトを格納する。

- `i18n.js` — 日本語／英語の翻訳辞書（`i18n.ja` / `i18n.en`）
- `script.js` — 言語切替・スクロール表示などのロジック本体。`i18n.js`のグローバル変数`i18n`に依存するため、`index.html`では`i18n.js`を先に読み込むこと

## 決済バックエンド（Stripe連携）について

有償版の決済処理・無料版/有償版のダウンロード配信は、Cloudflare Pages Functionsの仕様上、リポジトリ直下の`functions/`ディレクトリに実装している（Pages Functionsはルート直下の`functions/`をファイルベースルーティングの対象とするため、`src/`配下には置けない）。

- `functions/api/checkout.js` — Stripe Checkout Session作成
- `functions/api/webhook.js` — Stripe Webhook受信（監査ログ・返金対応用途、ダウンロード可否判定には使わない）
- `functions/api/download.js` — 有償版ダウンロード（Stripe決済確認あり）
- `functions/api/download-free.js` — 無料版ダウンロード（決済確認なし）

exe実体はいずれもCloudflare R2（バケット`chronos-releases`）で管理し、このリポジトリには含めない。設計の詳細は`Tasks/有償版決済導線_SOW.md`参照。
