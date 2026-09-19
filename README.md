# Lucud Brain コーポレートサイト

素の HTML / CSS / JS を Cloudflare Workers（静的アセット + Functions）に載せたコーポレートサイト。
仕様は [SPEC.md](SPEC.md) にある。本書は「触るときに最初に読むもの」に絞る。

**このサイトは平時は保守しない。** 数か月触らない期間が常態である。
そのため、ビルドツールもフレームワークも npm 依存も持たない。`git clone` した中身がそのまま配信物である。

---

## 1. 最初に知っておくこと

| | |
|---|---|
| ビルド | **無い。** `public/` の中身がそのまま配信される |
| 依存パッケージ | **無い。** `package.json` は作らない |
| デプロイ | GitHub へ push すると Cloudflare 側でデプロイされる |
| ドメイン | 未確定。いまは `*.workers.dev` 前提（§3 の「ドメイン確定時にやること」参照） |
| 言語 | 日本語が `/`、英語が `/en/`。i18n の辞書とエンジンは持たない |

---

## 2. ディレクトリの読み方

```
functions/lib/      複数のエンドポイントから呼ばれるロジック
functions/api/      HTTPエンドポイント。1ファイル1エンドポイント
worker.js           ルーティング（ルートテーブル）
public/             公開されるファイルの全て
tests/              検査スクリプト。public/ の外に置く
```

置き場所に迷ったときの判断基準は SPEC §4.1 にある。要点だけ再掲する。

| 判断 | 置き場所 |
|---|---|
| 2ページ以上で使う | `public/assets/` |
| 1プロダクトでしか使わない | `public/products/<name>/assets/` |
| 英語版のページ | `public/en/` に日本語側と同じ階層で |
| 英語版が使う CSS・画像 | 日本語側と同じものを参照する。**複製しない** |
| ヘッダー・フッター | `public/assets/js/partials.js`（1箇所だけ） |
| 配布PDF | `public/docs/<区分>/`。プロダクト固有でも例外なくここ |
| プロダクト固有の値（価格ID・R2キー・遷移先） | `functions/lib/products.js` **のみ** |

**`public/` の下にドキュメントを置かないこと。** 置いたものはそのまま公開される。

---

## 3. よくある作業

### プロダクトを追加する

触るのは3箇所だけで済むようにしてある（SPEC §8.2）。

1. `functions/lib/products.js` に1エントリ足す
2. `public/products/<name>/` と `public/en/products/<name>/` を作る
3. `public/docs/<name>/` を作る ← **忘れやすい。** §4.3 の唯一の例外

そのあと `public/sitemap.xml` に日英の全URLを足す（手で更新する）。

### プランを追加する

`products.js` の `plans` に1エントリと、環境変数を1つ。
サブスクを足す場合は買い切りとの差が4箇所に閉じている（SPEC §8.2）。認可設計は導入時に別途起こす。

### 同意文言を変える

1. `public/assets/js/consent.js` の文言を直す
2. `functions/lib/products.js` の `consentVersion` を上げる
3. `public/legal/consent/<新しい版>.html` を追加する（**既存の版は改変しない**）
4. LP の `data-consent-version` を新しい版に合わせる（日英とも）

版と時刻は Stripe の決済メタデータに残る。チャージバックの証拠として使うため、
版番号だけでなく文言そのものを残すのが要点である（SPEC §8.4）。

### 販売しない地域を変える

`functions/lib/regions.js` の1箇所。理由も併記すること。
`/api/checkout` が 451 を返し、LP 側は `/api/region` の結果で購入ボタンを無効化する。

### 配色を変える

`public/assets/css/tokens.css` の1ファイル。他の CSS に生の色を書かない。
背景色を変えたときは `public/site.webmanifest` の `theme_color` / `background_color` も合わせる。
CSS 変数を参照できないため、ここだけは生の値を持っている。

### Web フォントを積む

いまは `@font-face` をコメントアウトし、ローカルフォントへのフォールバックだけで組んでいる。
外部 CDN からは読み込まない（SPEC §7.5）。積むときは:

1. サブセット化した woff2 を `public/assets/fonts/` に置く（`site-body-400.woff2` 等）
2. `tokens.css` の `@font-face` ブロックのコメントを外し、`src` をファイル名に合わせる
3. `--font-display` / `--font-body` の先頭に `"SiteDisplay"` / `"SiteBody"` を足す
4. `font-display: swap` は付けたままにする

CSP は `font-src 'self'` なので `_headers` の変更は要らない。
書体とウェイトは未確定である（SPEC §10.1）。容量に効くので決めてから置く。

### ドメインが確定したら

以下を併せて更新する（SPEC §3）。

- `wrangler.jsonc` の `name`
- 全 HTML の `canonical` / `hreflang` / `og:url` の絶対URL（いまは `https://pawgress-site.workers.dev`）
- `public/sitemap.xml` と `public/robots.txt` の絶対URL
- Wrangler の変数 `SITE_BASE_URL`（Stripe の `success_url` / `cancel_url` はここから組む。コード変更は要らない）

---

## 4. ローカルで動かす

Wrangler はリポジトリの依存に入れていない。使うときだけ `npx` で呼ぶ。

```sh
npx wrangler dev          # http://127.0.0.1:8787
npx wrangler tail         # 本番の構造化ログをリアルタイムで見る
```

Stripe と R2 を触る動作確認には秘密情報が要る。`.dev.vars`（`.gitignore` 済み）に置く。

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_PAWGRESS_PAID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
SITE_BASE_URL=http://127.0.0.1:8787
```

本番では Wrangler の secret として持つ。**リポジトリに入れない。**

| 変数 | 用途 | 種別 |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe API の認証 | secret |
| `STRIPE_PRICE_PAWGRESS_PAID` | 有償版の Price ID。参照元は `products.js` の `priceEnvKey` | secret |
| `STRIPE_WEBHOOK_SECRET` | Webhook 署名の検証 | secret |
| `SITE_BASE_URL` | `success_url` / `cancel_url` のベース。未設定ならリクエストの origin を使う | 変数 |

`request.cf.country` はローカルの `wrangler dev` では期待どおりに取れないことがある（SPEC §10.2 の 7）。
地域判定の確認は本番かプレビューで行う。

---

## 5. 検査

`tests/` は CI 専用ではない。手で回すものと同じものを CI にも呼ばせる想定である（SPEC §7.5）。

```sh
bash tests/check-placeholders.sh   # 【仮】[TBD] example.com の残存
bash tests/check-links.sh          # 内部リンク・PDF の存在
bash tests/check-meta.sh           # title / description / canonical / OGP / hreflang の欠落
node tests/check-i18n.mjs          # 日英ページの構造一致と hreflang の相互参照
bash tests/smoke.sh <ベースURL>     # デプロイ後。200 / 404 / CSPヘッダ
```

`check-placeholders.sh` は**いまは失敗するのが正しい**。
文言・URL・ロゴが未確定であり、それを機械的に洗い出すための道具だからである。公開前に0件にする。

### プレースホルダの見分け方

差し替えが要るものは、見ただけで分かるようにしてある。

| 印 | どこに出るか |
|---|---|
| `【仮】` / `[TBD]` | 本文・見出し・alt。日本語ページと英語ページ |
| `example.com` | 未確定のURL（ブログ・X・メールアドレス） |
| **橙色の破線枠** | プレースホルダ画像すべて。ロゴ・アイコン・OGP画像・ダミー画像・配布PDF |
| **「仮」のバッジ** | ロゴ（ヘッダーとファビコン） |
| 画像に焼き込んだ文字 | 用途・実寸・比率・参照すべきSPECの節 |

検出は文字列一致で行う。画像とPDFにも印を埋めてあるため、一覧を手で管理する必要はない。

- PNG は `tEXt` チャンクに `PLACEHOLDER` を持つ
- `favicon.svg` はコメントに `PLACEHOLDER` を持つ
- PDF は本文に `[TBD]` を持つ

実物に差し替えれば印ごと消え、`check-placeholders.sh` が自動的に緑になる。
**逆に、印を消すだけで中身を差し替えない、ということをしてはならない。**

プレースホルダ画像は依存を持ち込まずに生成している（PNG エンコードと 5x7 のビットマップフォントを自前で持つ）。
その都合で焼き込める文字は ASCII に限られ、画像内の文面は英字になっている。
ベクタである `favicon.svg` は制約を受けないため「仮」を入れてある。

リリース前チェックリストは SPEC §7.5 にある。手で確認する項目（実機での CSP 確認、テストモードでの決済通し、
同意記録が Stripe に入っているか、閾値ゼロ地域からの購入が弾かれるか）はスクリプトでは代替できない。

---

## 6. 記録はどこを見るか

いわゆるログファイルは存在しない。見る場所は3つあり、用途が違う（SPEC §8.4）。

| 見る場所 | 何が見えるか | 保持 |
|---|---|---|
| Stripe → 支払い → 対象の決済 | 同意の版と時刻、金額、購入者、返金・異議 | 実質恒久 |
| Stripe → 開発者 → イベント / ログ | Webhook 配信履歴、API リクエスト履歴 | 30日程度 |
| Cloudflare → 該当 Worker → Observability | `console.log` の出力（ダウンロード実行・エラー） | 無料3日 / 有料7日 |

法的に意味を持つ記録は Stripe に置く。Workers Logs に消えて困るものを入れない。

---

## 7. リポジトリだけでは復旧できないもの

事故ったときに必要になる情報（SPEC §7.5）。値はここに書かない。**どこにあるかだけ**を書く。

- R2 バケット名と、中に置く exe のキー（`products.js` の `r2Key` と一致させる）
- Stripe の商品・価格ID、Webhook の宛先とイベント種別、署名シークレット
- Wrangler の secret 一覧（名前は §4 の表にある。値は持たない）
- ドメインと DNS の設定先
- Cloudflare / Stripe アカウントの管理者と、登録している支払い方法
- Stripe を解約・乗り換えする場合は、事前に決済履歴を CSV でエクスポートする

---

## 8. 公開前に必ず潰すもの

| # | 内容 | 参照 |
|---|---|---|
| 1 | `【仮】` `[TBD]` `example.com` を全て実文・実URLに差し替える | §2.4 |
| 2 | legal 3種の本文（日英）と同意項目の文言を実文にする | §10.1 |
| 3 | 会社の法的実体・正式名称・会社概要を確定させ、特商法表記に反映する | §10.1 |
| 4 | ロゴ・ファビコン・アプリアイコン・OGP画像を差し替える（いまは全て橙の破線枠つきのプレースホルダ。ヘッダーのロゴは `partials.js` の `BRAND_MARK` にもある） | §2.4 |
| 5 | `functions/lib/stripe.js` の `STRIPE_API_VERSION` が実在する版か確認する | §7.5 |
| 6 | 閾値ゼロ地域の一覧を専門家に当て、`regions.js` に反映する | §7.2 / §10.2 |
| 7 | `/api/download-free` に地域制限が要るかを確認する（**確認待ち**。決めていないのではない） | §8.1 / §10.2 |
| 8 | 配布PDF 4本を実物に差し替える（いまは「これは仮」とだけ書かれた1ページ） | §4.3 |
| 9 | CSP を入れた状態で全ページを実機確認する | §10.2 |
