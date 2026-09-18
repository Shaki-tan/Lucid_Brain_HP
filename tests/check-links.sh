#!/usr/bin/env bash
# 内部リンクと配布PDFの存在確認（SPEC §7.5）。
#
# href / src のルート相対パスを拾い、public/ 配下に実体があるかを見る。
# 拡張子なしURL（/legal/privacy）は public/legal/privacy.html に、
# ディレクトリ（/products/pawgress/）は public/products/pawgress/index.html に対応づける。
#
#   bash tests/check-links.sh

set -uo pipefail
cd "$(dirname "$0")/.."

status=0
checked=0

# ルート相対パスを、public/ 配下の実ファイルへ解決する。
# 見つかれば 0、見つからなければ 1 を返す。
resolve() {
  local path="$1"
  local base="public${path}"

  [ -f "$base" ] && return 0
  [ -f "${base}.html" ] && return 0
  [ -d "$base" ] && [ -f "${base%/}/index.html" ] && return 0
  return 1
}

echo "== 内部リンクの存在確認 =="

while IFS= read -r file; do
  # href="/..." と src="/..." を拾う。//example.com のようなスキーム相対は除く。
  while IFS= read -r raw; do
    # フラグメントとクエリを落とす
    path="${raw%%#*}"
    path="${path%%\?*}"
    [ -z "$path" ] && continue

    # Worker が処理するパスは静的アセットとして存在しない
    case "$path" in
      /api/*) continue ;;
    esac

    checked=$((checked + 1))
    if ! resolve "$path"; then
      echo "NG  $file -> $path"
      status=1
    fi
  done < <(grep -oE '(href|src)="/[^"]*"' "$file" \
             | sed -E 's/^(href|src)="//; s/"$//' \
             | grep -v '^//')
done < <(find public -name '*.html' -type f)

echo "  $checked 件を確認した"

# レジストリ・robots・sitemap が指す先も見る
echo
echo "== sitemap.xml が指すURLの存在確認 =="
sitemap_checked=0
while IFS= read -r loc; do
  path="${loc#https://*.workers.dev}"
  path="${loc#*workers.dev}"
  [ -z "$path" ] && path="/"
  sitemap_checked=$((sitemap_checked + 1))
  if ! resolve "$path"; then
    echo "NG  sitemap.xml -> $path"
    status=1
  fi
done < <(grep -oE '<loc>[^<]+</loc>' public/sitemap.xml | sed -E 's|</?loc>||g')
echo "  $sitemap_checked 件を確認した"

echo
if [ "$status" -eq 0 ]; then
  echo "内部リンクは全て解決できた。"
else
  echo "解決できない内部リンクがある。"
fi
exit "$status"
