#!/usr/bin/env bash
# デプロイ後のスモーク。主要URLが 200 / 404 を返すか、CSP ヘッダが付いているかを curl で見る。
# （SPEC §7.5 / リリース前チェックリストの 6・7）
#
#   bash tests/smoke.sh                                   # 既定のベースURLに対して
#   bash tests/smoke.sh https://lucud-brain-site.workers.dev  # ベースURLを指定して
#   bash tests/smoke.sh http://127.0.0.1:8787              # wrangler dev に対して

set -uo pipefail

BASE="${1:-https://lucud-brain-site.workers.dev}"
BASE="${BASE%/}"
status=0

# 想定ステータスと実際を突き合わせる
expect_status() {
  local path="$1"
  local want="$2"
  local got
  got=$(curl -s -o /dev/null -w '%{http_code}' -L "${BASE}${path}")
  if [ "$got" = "$want" ]; then
    echo "OK  $want  $path"
  else
    echo "NG  期待 $want / 実際 $got  $path"
    status=1
  fi
}

echo "== ${BASE} に対するスモーク =="
echo
echo "-- 主要ページ（200） --"
for path in \
  / \
  /products/pawgress/ \
  /products/pawgress/thanks \
  /legal/privacy \
  /legal/refund \
  /legal/tokushoho \
  /legal/terms \
  /en/ \
  /en/products/pawgress/ \
  /en/products/pawgress/thanks \
  /en/legal/privacy \
  /en/legal/refund \
  /en/legal/tokushoho \
  /en/legal/terms \
  /robots.txt \
  /sitemap.xml \
  /site.webmanifest \
  /docs/common/gemini-api-key.ja.pdf \
  /docs/pawgress/user-guide.ja.pdf
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
echo "-- セキュリティヘッダ --"
headers=$(curl -s -D - -o /dev/null -L "${BASE}/")
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
  line=$(curl -s -D - -o /dev/null -L "${BASE}${path}" | grep -i '^cache-control:' | tr -d '\r' | head -1)
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
expect_revalidate /products/pawgress/assets/css/pawgress.css

echo
if [ "$status" -eq 0 ]; then
  echo "スモークは全て通った。"
else
  echo "スモークに失敗がある。"
fi
exit "$status"
