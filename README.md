# Lucid Brain コーポレートサイト

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
| デプロイ | push で行う。`main` → 本番、`develop` → テスト環境（Access の内側）。検査に落ちたら出ない（§4） |
| URL | 本番 `https://lucidbrain.jp`（`www.` 付きはダッシュボードのリダイレクトルールでここへ 301・SPEC §3）、テスト `https://staging.lucidbrain.jp`。`*.workers.dev` は使わない |
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
| ヘッダー・フッター | `public/assets/js/partials.js`（1箇所だけ。構成はコーポレート／プロダクトで分かれるがファイルは分けない） |
| 配布PDF | `public/docs/<区分>/`。プロダクト固有でも例外なくここ |
| プロダクト固有の値（金額・配布ファイル名・遷移先） | `functions/lib/products.js` **のみ** |

**`public/` の下にドキュメントを置かないこと。** 置いたものはそのまま公開される。

---

## 3. よくある作業

### プロダクトを追加する

触るのは4箇所だけで済むようにしてある（SPEC §8.2 / §5.2）。

1. `functions/lib/products.js` に1エントリ足す
2. `public/assets/js/partials.js` の `PRODUCTS` に表示名を足す。ヘッダーのロゴタイプに出る。
   足さないとコーポレート側の構成（社名のロゴタイプ、返金ポリシーなしのフッター）で表示される。
   有償プランを持つなら `public/products/<name>/assets/consent-items.json` に同意項目の文言も置く（SPEC §8.3）
3. `public/products/<name>/` と `public/en/products/<name>/` を作る。
   そのプロダクトの配色は、そのプロダクトのCSSの先頭に持つ（→ 下の「配色を変える」）
4. `public/docs/<name>/` を作る ← **忘れやすい。** §4.3 の唯一の例外

そのあと `public/sitemap.xml` に日英の全URLを足す（手で更新する）。

### プランを追加する

`products.js` の `plans` に1エントリ。有償なら `unitAmount` / `currency`、配布物があるなら `releaseFile` を持たせる。
そのあと `node scripts/ops.mjs upload` → `deploy` → `stripe` を流す。secret の名前は増えない（§4）。
サブスクを足す場合は買い切りとの差が4箇所に閉じている（SPEC §8.2）。認可設計は導入時に別途起こす。

### 同意文言を変える

1. `public/products/<name>/assets/consent-items.json` の文言を直す（日英とも）
2. `functions/lib/products.js` の `consentVersion` を上げる
3. LP の `data-consent-version` を新しい版に合わせる（日英とも）
4. `node tests/check-consent.mjs` を通す

**文言のファイルは1つだけ。** ブラウザのダイアログと、決済時の Stripe への記録が同じものを読む。
版・時刻・**文言そのもの**が決済メタデータに残るので、スナップショットのページは要らない（SPEC §8.4）。

文言をクライアントから送らせてはならない。送らせると Stripe に残るのが「購入者が申告した文言」になり、
チャージバックの証拠にならない。サーバが `ASSETS` 越しに同じ JSON を読んでいる。

### 販売しない地域を変える

`functions/lib/regions.js` の1箇所。理由も併記すること。
`/api/checkout` が 451 を返し、LP 側は `/api/region` の結果で購入ボタンを無効化する。

### 変更を手元で確認する

```
node scripts/preview.mjs        # http://127.0.0.1:8788/
```

`Cache-Control: no-store` を返すので、**リロードすれば必ず最新が出る**。
拡張子なしURL（`/legal/terms`）とディレクトリ（`/products/pawgress/`）、404 の返し方は wrangler と同じ規則で解決する。
依存はなく、Node だけで動くのでダウンロードも発生しない。

`/api/*` は持たない（501 を返す）。決済・ダウンロード・地域判定を触るときは `npx wrangler dev` を使う。

**「直したはずなのに変わらない」ときの確認順**

1. `node scripts/preview.mjs` で見る。ここで変わっていなければ、直っていないのはコードである
2. 変わっているなら、見ていたのは別のものである。候補は2つ
   - **本番・テストのURL** — push していなければ古いまま。push 後はビルドが終わるまで数分かかる。ビルドが検査で落ちていないかも見る
   - **古いタブ** — DevTools を開いて Network タブの「Disable cache」を入れる。または Ctrl+Shift+R

`_headers` では HTML も CSS・JS も `no-cache`（毎回再検証）にしてある。
ファイル名にハッシュを付けられない構成で `max-age` を与えると、その秒数のあいだ
「新しいHTML + 古いCSS」が成立し、レイアウトが崩れるためである（SPEC §7.5）。
**ここを「速くするため」に長くしない。** 速くしたいならファイル名にハッシュを付けるのが先である。

### 配色を変える

配色は範囲ごとに定義元が1つある。触るのはそのファイルだけで、他の CSS に生の色を書かない。

| 範囲 | 配色 | 触るファイル |
|---|---|---|
| コーポレート側（トップ・legal・404） | 白基調 | `public/assets/css/tokens.css` |
| Pawgress（LP・決済完了の日英4枚） | 黒基調 | `public/products/pawgress/assets/css/pawgress.css` の先頭 |

変数名は両者で同じ。プロダクト側が同名の `:root` を後から上書きする形になっている。
新しいプロダクトを足すときも、そのプロダクトのCSSの先頭に自分の配色を置く。
OS のダークモード（`prefers-color-scheme`）では切り替えない。範囲ごとに固定している。

背景色を変えたときは、ブラウザUIの色も合わせる。CSS 変数を参照できないため、この2箇所だけ生の値を持っている。

- 白いページ: `public/site.webmanifest` の `theme_color` / `background_color`
- Pawgress: 各ページの `<meta name="theme-color">`

### Web フォントを積む

**セルフホストする。外部 CDN からは読み込まない**（SPEC §7.5）。書体は決定済みで、
和文が **BIZ UDPGothic**（OFL）、欧文が **Inter**（OFL）、ウェイトは 400 と 700 だけである。

作業中。手順の全体と決定の根拠は `Tasks/` の SOW にある。

```
scripts/font-subset/charset-base-ja.txt   和文の漢字以外（かな・約物・全角英数・記号・ギリシャ）※ 済
scripts/font-subset/charset-joyo.txt      常用漢字 2136字                                      ※ 未配置
scripts/font-subset/charset-latin.txt     Inter に担当させる範囲                                ※ 済
```

残っているのは次の3つ。

1. `scripts/font-subset/charset-joyo.txt` を用意する（`scripts/font-subset/README.md` の手順）
2. `pyftsubset` で woff2 を作り、`public/assets/fonts/` に置く（同上）
3. `tokens.css` の `@font-face` のコメントを外し、`size-adjust` を目視で決める

`node tests/check-glyphs.mjs` が、サイトの文字がサブセットに収まっているかを確認する。
**フォントが未配置のあいだは何も確認せず通り、置いた時点から自動的に有効になる。**

**サブセットを作り直したら、必ずファイル名のバージョンを上げる**（`-v1` → `-v2`）。
`/assets/fonts/*` は1年キャッシュ（`immutable`）なので、同じ名前で中身を差し替えると
古いフォントが最長1年残る。`tokens.css` の `url()` も同時に変える。**この2つは必ずセットである。**

CSP は `font-src 'self'` なので `_headers` の CSP 行の変更は要らない。

### 公開URLを変える

**原則として変えない。** 同じURLが次の場所にあり、変えるなら全部を揃える（SPEC §3）。

- `wrangler.jsonc` の `routes` と `vars.SITE_BASE_URL`（Stripe の `success_url` / `cancel_url` と Webhook の宛先はここから組む）
- 全 HTML の `canonical` / `hreflang` / `og:url` の絶対URL
- `public/sitemap.xml` と `public/robots.txt` の絶対URL
- Cloudflare Access のアプリケーションのホスト名

変えたらコミットして push し、デプロイされてから `node scripts/ops.mjs stripe` を流す。Webhook が新しい宛先で作られる。

---

## 4. 環境・デプロイ・設定

### 環境とデプロイ

本番とテストは別の Worker である（SPEC §7.7）。**デプロイは push で行う。**

| | 本番 | テスト |
|---|---|---|
| ブランチ | `main` に push → 本番に出る | `develop` に push → テスト環境に出る |
| Worker | `lucid-brain-site` | `lucid-brain-site-staging` |
| Stripe | 公開前はテストモード | 常にテストモード |
| 見られる人 | 公開までは Access で許可した人だけ。公開時に外す（`scripts/ops/config.mjs` の `IS_LAUNCHED`） | Cloudflare Access で許可した人だけ |

ビルドは `node scripts/ops.mjs ci` を呼び、検査に落ちたらデプロイしない。手元で同じ検査を回すなら `node scripts/ops.mjs check`。

### 構築・設定

`scripts/ops.mjs` で行う（SPEC §7.6）。依存は無く、Cloudflare は `npx` 経由の wrangler（版は固定）、
Stripe は REST API を直接呼ぶ。どのコマンドも何度流しても同じ状態に収束する。
**`--env staging` を付けるとテスト環境が対象になる。** 付けなければ本番。

```sh
node scripts/ops.mjs status          # 何が済んでいて何が残っているか。迷ったらまずこれ
node scripts/ops.mjs setup           # 初回構築。ログイン → R2 → exe → Worker 作成 → Stripe
node scripts/ops.mjs upload pawgress paid ./Pawgress-Windows-1.0.1-Setup.exe   # 版を上げる
node scripts/ops.mjs restore pawgress paid 1.0.0                                # 前の版に戻す
node scripts/ops.mjs stripe          # 商品・価格・Webhook を揃え、secret を入れる
node scripts/ops.mjs secret STRIPE_SECRET_KEY                   # secret を1つ入れ直す
node scripts/ops.mjs smoke           # スモーク（テスト環境はサービストークンが要る）
node scripts/ops.mjs logs            # ログを流し見る
node scripts/ops.mjs deploy          # 手元からデプロイ（予備）。環境に対応するブランチにいるときだけ出す

node scripts/ops.mjs status --env staging   # テスト環境。Access と Webhook の素通しも確かめる
```

**Stripe のキーはどこにも保存しない。** 環境変数 `STRIPE_API_KEY` か、実行時の伏字入力で渡す。
テスト / 本番はキーの接頭辞（`sk_test_` / `sk_live_`）で決まる。本番へ切り替えるときは本番のキーで `stripe` を流し直す。
価格・Webhook は本番側に作られ、secret も差し替わる。

**exe は版の控え → latest の順に置く**（SPEC §8.5）。版はファイル名（`Pawgress-Windows-<版>-Setup.exe`）から読み、
型に合わないファイルは置かない。控え（`pawgress/<版>/`）は上書きしないので、同じ版を置き直すなら `--overwrite` が要る。
exe の差し替えだけならデプロイは要らない。Worker はダウンロードのたびに latest を読む。

**名前はプロダクトが増えても増えない。** Worker（`lucid-brain-site`）・R2 バケット（`lucid-brain-releases`）・
secret（3つ）は会社で1つずつで、プロダクトの違いは R2 のフォルダと Stripe の商品ID、`STRIPE_PRICES` のキーで分ける。

| よくある作業 | コマンド |
|---|---|
| 価格を変える | `products.js` の `unitAmount` と LP の表示（日英）を直す → push でデプロイ → `stripe` |
| Webhook のイベントを足す | `webhook.js` の `WEBHOOK_EVENTS` に足す → push でデプロイ → `stripe` |
| Webhook の署名シークレットを取り直す | `stripe --rotate-webhook` |
| デプロイを戻す | `npx wrangler@<版> rollback --env=`（テストは `--env staging`。版は `scripts/ops/shell.mjs` の `WRANGLER`） |

どの作業も、テスト環境で試すなら `--env staging` を付けて先に流す。

API では設定できずダッシュボードで行うもの（R2 の利用開始、GitHub の接続、Access、Stripe の公開情報とメール設定）は
SPEC §7.6 / §7.7 にある。

---

## 5. ローカルで動かす

```sh
npx wrangler dev          # http://127.0.0.1:8787
```

Stripe と R2 を触る動作確認には秘密情報が要る。`.dev.vars`（`.gitignore` 済み）に置く。

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICES='{"pawgress_paid":"price_..."}'
STRIPE_WEBHOOK_SECRET=whsec_...
SITE_BASE_URL=http://127.0.0.1:8787
```

本番では Wrangler の secret として持つ。**リポジトリに入れない。**

| 変数 | 用途 | 種別 |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe API の認証 | secret |
| `STRIPE_PRICES` | 全プランの Price ID を JSON で1つに。キーは `<product>_<plan>`。`ops.mjs stripe` が組んで入れる | secret |
| `STRIPE_WEBHOOK_SECRET` | Webhook 署名の検証 | secret |
| `SITE_BASE_URL` | `success_url` / `cancel_url` のベース。空ならリクエストの origin を使う | `wrangler.jsonc` の `vars` |

`request.cf.country` はローカルの `wrangler dev` では期待どおりに取れないことがある（SPEC §10.2 の 7）。
地域判定の確認は本番かプレビューで行う。

---

## 6. 検査

`tests/` は CI 専用ではない。手で回すものと同じものを CI にも呼ばせる想定である（SPEC §7.5）。

```sh
bash tests/check-placeholders.sh   # 【仮】[TBD] example.com の残存
bash tests/check-links.sh          # 内部リンク・PDF の存在
bash tests/check-meta.sh           # title / description / canonical / OGP / hreflang の欠落
node tests/check-i18n.mjs          # 日英ページの構造一致と hreflang の相互参照
node tests/check-consent.mjs       # 同意項目の文言と、Stripe へ記録できる状態か
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

## 7. 記録はどこを見るか

いわゆるログファイルは存在しない。見る場所は3つあり、用途が違う（SPEC §8.4）。

| 見る場所 | 何が見えるか | 保持 |
|---|---|---|
| Stripe → 支払い → 対象の決済 | 同意の版と時刻、金額、購入者、返金・異議 | 実質恒久 |
| Stripe → 開発者 → イベント / ログ | Webhook 配信履歴、API リクエスト履歴 | 30日程度 |
| Cloudflare → 該当 Worker → Observability | `console.log` の出力（ダウンロード実行・エラー） | 無料3日 / 有料7日 |

法的に意味を持つ記録は Stripe に置く。Workers Logs に消えて困るものを入れない。

---

## 8. リポジトリだけでは復旧できないもの

事故ったときに必要になる情報（SPEC §7.5）。値はここに書かない。**どこにあるかだけ**を書く。

- R2 に置く exe の実物（R2 に控えはあるが、バケットごと失ったときは手元の実物が要る）
- Webhook の署名シークレット（無くしたら `node scripts/ops.mjs stripe --rotate-webhook` で取り直せる）
- Wrangler の secret 一覧（名前は §4 の表にある。値は持たない）
- ドメインと DNS の設定先
- Cloudflare / Stripe アカウントの管理者と、登録している支払い方法
- Stripe を解約・乗り換えする場合は、事前に決済履歴を CSV でエクスポートする

---

## 9. 公開前に必ず潰すもの

| # | 内容 | 参照 |
|---|---|---|
| 1 | `【仮】` `[TBD]` `example.com` を全て実文・実URLに差し替える。X・メール・note のURLはトップページの CONTACT 節にあり、日英2ファイル（`public/index.html` と `public/en/index.html`）に同じものが入っている | §2.4 |
| 2 | legal 4種の本文（日英）と同意項目の文言を実文にする | §10.1 |
| 3 | 会社の法的実体・正式名称・所在地を確定させ、特商法表記とトップページの CONTACT 節に反映する | §10.1 |
| 4 | ロゴ・ファビコン・アプリアイコン・OGP画像を差し替える（いまは全て橙の破線枠つきのプレースホルダ。ヘッダーはロゴタイプのみでアイコンを持たない） | §2.4 |
| 5 | `functions/lib/stripe.js` の `STRIPE_API_VERSION` が実在する版か確認する | §7.5 |
| 6 | 閾値ゼロ地域の一覧を専門家に当て、`regions.js` に反映する | §7.2 / §10.2 |
| 7 | `/api/download-free` に地域制限が要るかを確認する（**確認待ち**。決めていないのではない） | §8.1 / §10.2 |
| 8 | 配布PDF 4本を実物に差し替える（いまは「これは仮」とだけ書かれた1ページ） | §4.3 |
| 9 | CSP を入れた状態で全ページを実機確認する | §10.2 |
