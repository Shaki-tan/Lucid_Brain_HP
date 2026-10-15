#!/usr/bin/env bash
# デプロイ後のスモーク。主要URLが 200 / 404 を返すか、CSP ヘッダが付いているかを curl で見る。
# （SPEC §7.5 / リリース前チェックリストの 6・7）
#
# 200 を期待するページ・PDF・CSS は public/ の中身から組む。プロダクト名をここに書かない。
#
#   bash tests/smoke.sh                                   # 既定のベースURLに対して
#   bash tests/smoke.sh https://lucidbrain.jp  # ベースURLを指定して
#   bash tests/smoke.sh http://127.0.0.1:8787              # wrangler dev に対して
#
# テスト環境は Cloudflare Access の内側にある（SPEC §7.7）。サービストークンを環境変数で渡すと、
# 全リクエストに付けて Access を通る。
#
#   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... bash tests/smoke.sh <テスト環境のURL>

set -uo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-https://lucidbrain.jp}"
BASE="${BASE%/}"
status=0

# サービストークンがあれば Access のヘッダを足す。転送を追わない確認でも使うので分けて持つ
ACCESS_ARGS=()
if [ -n "${CF_ACCESS_CLIENT_ID:-}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
  ACCESS_ARGS+=(-H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}")
fi
# 全 curl に付ける引数
CURL_ARGS=(-s -L "${ACCESS_ARGS[@]}")

# 想定ステータスと実際を突き合わせる。3つ目以降は curl にそのまま渡す
expect_status() {
  local path="$1"
  local want="$2"
  local got
  got=$(curl "${CURL_ARGS[@]}" "${@:3}" -o /dev/null -w '%{http_code}' "${BASE}${path}")
  if [ "$got" = "$want" ]; then
    echo "OK  $want  $path"
  else
    echo "NG  期待 $want / 実際 $got  $path"
    status=1
  fi
}

# public/ 配下のファイルを、配信されるURLのパスに直す。
# 拡張子なしURLとディレクトリの対応は wrangler.jsonc の html_handling に従う（SPEC §3）
to_url_path() {
  local path="/${1#public/}"
  case "$path" in
    */index.html) path="${path%index.html}" ;;
    *.html) path="${path%.html}" ;;
  esac
  printf '%s' "$path"
}

echo "== ${BASE} に対するスモーク =="
echo
echo "-- ページと配布PDF（200） --"
# 一覧を手で持たない。public/ に置いた全ページと全PDFが配信されていることを見る。
# プロダクトを足しても、ここは書き換えずに済む
while IFS= read -r file; do
  expect_status "$(to_url_path "$file")" 200
done < <({
  find public -name '*.html' -type f ! -name '404.html'
  find public/docs -name '*.pdf' -type f
} | LC_ALL=C sort)

echo
echo "-- プロダクトに依らないファイル（200） --"
for path in \
  /robots.txt \
  /sitemap.xml \
  /site.webmanifest
do
  expect_status "$path" 200
done

echo
echo "-- 存在しないURL（404。ソフト404 にしない） --"
expect_status /this-page-does-not-exist 404
expect_status /en/this-page-does-not-exist 404

echo
echo "-- API のメソッド制限 --"
expect_status /api/checkout 405
expect_status /api/does-not-exist 404

echo
echo "-- ページ遷移でも /api/* が Worker に届く --"
# ダウンロードはリンクのクリックと location.href、つまりページ遷移として要求される。
# 一致するファイルが無いページ遷移を、Cloudflare は Worker を呼ばずに 404 ページで返す。
# wrangler.jsonc の run_worker_first が効いていれば Worker に届き、product が無いので 400 になる（SPEC §8.1）。
expect_status /api/download-free 400 -H 'Sec-Fetch-Mode: navigate'

echo
echo "-- ダウンロードの失敗は決済完了ページへ戻す --"
# ページ遷移として失敗したら、素のテキストではなく決済完了ページのエラーパネルへ 302 で戻す（SPEC §8.1）。
# 戻り先に session_id を付けると自動ダウンロードが繰り返されるので、付いていないことも見る。
# プロダクトとプランは決済完了ページの data 属性から拾い、ここに書かない。
# 転送を追わないよう、CURL_ARGS（-L 付き）ではなく Access のヘッダだけを付ける
expect_thanks_redirect() {
  local thanks="$1"
  local product plan lang location
  product=$(grep -oE 'data-product="[^"]+"' "$thanks" | head -1 | sed -E 's/.*="(.*)"/\1/')
  plan=$(grep -oE 'data-plan="[^"]+"' "$thanks" | head -1 | sed -E 's/.*="(.*)"/\1/')
  # 決済完了ページは自分の言語を付けて /api/download を呼ぶ（thanks.js）。英語なら /en/ へ戻る
  lang=$(grep -oE '<html lang="[^"]+"' "$thanks" | head -1 | sed -E 's/.*="(.*)"/\1/')
  local path="/api/download?product=${product}&plan=${plan}&lang=${lang}"
  location=$(curl -s "${ACCESS_ARGS[@]}" -H 'Sec-Fetch-Mode: navigate' -D - -o /dev/null "${BASE}${path}" \
    | grep -i '^location:' | tr -d '\r' | head -1)
  location="${location#*: }"
  local want
  want="$(to_url_path "$thanks")?error=missing"
  if [ "$location" = "$want" ]; then
    echo "OK  302  $path -> $location"
  else
    echo "NG  $path の戻り先が ${location:-（無い）}（期待は $want）"
    status=1
  fi
}
while IFS= read -r thanks; do
  expect_thanks_redirect "$thanks"
done < <(find public -path '*/products/*/thanks.html' -type f | LC_ALL=C sort)

echo
echo "-- セキュリティヘッダ --"
headers=$(curl "${CURL_ARGS[@]}" -D - -o /dev/null "${BASE}/")
for header in \
  'content-security-policy' \
  'x-content-type-options' \
  'referrer-policy' \
  'permissions-policy'
do
  if printf '%s' "$headers" | grep -qi "^${header}:"; then
    echo "OK  $header"
  else
    echo "NG  $header が付いていない"
    status=1
  fi
done

if printf '%s' "$headers" | grep -i '^content-security-policy:' | grep -q "unsafe-inline"; then
  echo "NG  CSP に unsafe-inline が入っている（SPEC §7.5）"
  status=1
else
  echo "OK  CSP に unsafe-inline が無い"
fi

echo
echo "-- キャッシュ制御 --"
# ファイル名にハッシュを付けない構成では、資産を長くキャッシュさせると
# 「新しいHTML + 古いCSS」でレイアウトが崩れる（SPEC §7.5）。
# ここは本番でしか確認できない。_headers が効いていないこと自体も検出する。
expect_revalidate() {
  local path="$1"
  local line
  line=$(curl "${CURL_ARGS[@]}" -D - -o /dev/null "${BASE}${path}" | grep -i '^cache-control:' | tr -d '\r' | head -1)
  local value="${line#*: }"
  if [ -z "$line" ]; then
    echo "NG  $path に Cache-Control が無い（_headers が効いていない可能性）"
    status=1
  elif printf '%s' "$value" | grep -qi 'no-cache\|no-store\|max-age=0'; then
    echo "OK  $path  $value"
  else
    echo "NG  $path  $value ← ハッシュ無しのファイルを長く持たせている"
    status=1
  fi
}
expect_revalidate /
expect_revalidate /assets/css/tokens.css
expect_revalidate /assets/js/partials.js
# プロダクト固有の CSS も同じ扱いであることを見る
while IFS= read -r file; do
  expect_revalidate "$(to_url_path "$file")"
done < <(find public/products -path '*/assets/css/*.css' -type f | LC_ALL=C sort)

echo
if [ "$status" -eq 0 ]; then
  echo "スモークは全て通った。"
else
  echo "スモークに失敗がある。"
fi
exit "$status"
