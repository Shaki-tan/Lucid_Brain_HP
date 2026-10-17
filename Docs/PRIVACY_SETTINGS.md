# プライバシーポリシーが前提にしている HP の設定

プライバシーポリシー（`public/legal/privacy.html`。清書 v2）は、次の設定をそのまま事実として書いている。
設定を変えると、プライバシーポリシーの記載が事実でなくなる。

**この表は、HP の設定についての決まりの正とする**（SPEC §7.5・§8.4 から参照する）。

## 決まり

**この表の設定を変えるときは、先に法務側へ知らせ、プライバシーポリシーの改定を済ませてから変える。**

正当に変えるときの順番:

1. 法務側へ知らせる
2. プライバシーポリシーを改定する（改定日を進めると、`consentVersion` の引き上げを `check-consent.mjs` が求める）
3. この表と、検査の期待値を直す
4. 設定を変える

検査は、気づかずに変えてしまうことを止めるためのものである。検査を通すために検査を緩めない。

## 設定の表

| # | HP の今の設定 | プライバシーポリシーの記載 | 変えたいときに要ること | 守っている検査 |
|---|---|---|---|---|
| 1 | Workers Logs の呼び出しログを止めている（`wrangler.jsonc` の `invocation_logs: false`） | 第6条第2項第2号「動作の記録に、氏名・メールアドレス・IP アドレスを含めない」 | 呼び出しログを戻す、別の方法（Logpush 等）で記録を残すなら、先に改定 | `check-wrangler.mjs` |
| 2 | ログの保持は Workers Logs の期間（最長7日） | 同上「最長7日間保存」 | 保持を延ばす、外部に転送するなら、先に改定 | 検査にできない（下の「検査にできないもの」） |
| 3 | コードのログは `session_id` 等を末尾6桁に切り、氏名・メール・IP を出さない | 同上、第9条（技術的な措置） | ログの項目を足すときも、氏名・メール・IP を入れない | `check-privacy-settings.mjs`（ログの項目） |
| 4 | 本サイト自身は Cookie を設定しない | 第6条第2項第3号 | 自前の Cookie を使うなら、先に改定。Cloudflare の機能（Bot Fight Mode 等）が付ける Cookie は、書き方で吸収済みなので自由に有効にしてよい | `check-privacy-settings.mjs`（Cookie） |
| 5 | アクセス解析は Cloudflare Web Analytics だけ | 第6条第2項第1号、第8条 | 別の解析やタグ（広告・SNS の埋め込みを含む）を入れるなら、先に改定 | `check-privacy-settings.mjs`（CSP・HTML） |
| 6 | 外部の事業者は Cloudflare・Stripe・Google（Gmail・Google ドライブ・Google フォーム）だけ。Cloudflare のメール転送は使わない | 第8条 | 個人データに触れる外部サービス（メール配信、フォーム、チャット等）を足すなら、先に改定 | `check-privacy-settings.mjs`（CSP・HTML・サーバの送信先）。メール転送と Google の各サービスは検査にできない |
| 7 | アンケートのフォームは外部（Google フォーム）で、本サイトでは回答を受けない | 第2条、第8条 | 自前のフォームを本サイトに作るなら、回答の保存先を第8条に足すため、先に改定 | `check-privacy-settings.mjs`（HTML のフォーム・CSP の `form-action`） |
| 8 | Stripe の metadata に同意の記録（版・時刻・言語・文言）を残す | 第2条（購入時の同意の記録） | 残す項目を増やす（接続元の国等）なら、先に相談 | 検査にできない（下の「検査にできないもの」） |
| 9 | 案内メールの受信の選択は置かない | 第3条 | 営業・案内のメールを送ると決めたら、チェックリストに任意の項目を足す | 検査にできない |

## 検査（`tests/check-privacy-settings.mjs`）が見ていること

`node scripts/ops.mjs check` / `ci` が流す。1つでも崩れるとデプロイしない。

| 対象 | 見ていること | 表の行 |
|---|---|---|
| 呼び出しログ | `check-wrangler.mjs` が見ている（検査は1か所に置く） | 1 |
| Cookie | `public/` の JS と `functions/`・`worker.js` に `document.cookie`・`cookieStore`・`Set-Cookie` が無い | 4 |
| ブラウザからの送信と埋め込み | `public/_headers` の CSP で、外部のホストを許しているのが `script-src` の `static.cloudflareinsights.com` と `connect-src` の `cloudflareinsights.com` だけ。ワイルドカード（`*`・`https:` 等）も無い。`frame-src`・`form-action` は自サイトだけ | 5・6・7 |
| HTML | `public/` の HTML に、外部の `<script src>`・`<iframe>`・`<embed>`・`<object>`・外部への `<form action>`・外部のスタイルシート等の読み込みが無い（`<a href>` と `canonical`・`alternate` は対象外） | 5・6・7 |
| サーバからの送信 | `functions/`・`worker.js` の URL の文字列が、Stripe（`https://api.stripe.com`）だけ | 6 |
| ログの項目 | `console.*` を呼んでいるのは `functions/lib/log.js` だけ。`logInfo` / `logError` に渡す項目に、`email`・`ip`・`name`・`address`・`customer*`・`session_id` の全体が無い（`session_tail` は可） | 3 |

## 検査にできないもの

ダッシュボードや運用で守る。変えるときは表の決まりに従う。

- **ログの保持の期間（行2）。** Workers Logs の保持は Cloudflare のプランで決まる。Logpush 等で外部に転送しない。
- **Stripe の metadata の項目（行8）。** `functions/lib/consent.js` と `functions/api/checkout.js` が組む。項目を足す変更は、レビューで止める。
- **Cloudflare のメール転送を使わないこと（行6）。** ダッシュボードの設定。
- **Google の各サービスの使い方（行6・7）。** 運用。
- **案内メールの選択を置かないこと（行9）。** 同意の項目（`consent-items.json`）の変更で起きる。項目を足す変更は、レビューで止める。
