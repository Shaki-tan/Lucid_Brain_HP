#!/usr/bin/env bash
# 必須メタの欠落検出（SPEC §2.3 / §7.5）。
#
# 全ページに title / description / canonical（絶対URL・自己参照）/ OGP / hreflang があるかを見る。
# 中身の妥当性までは見ない。欠落だけを機械的に潰すための道具である。
#
#   bash tests/check-meta.sh

set -uo pipefail
cd "$(dirname "$0")/.."

status=0
pages=0

require() {
  local file="$1"
  local label="$2"
  local pattern="$3"
  if ! grep -qE "$pattern" "$file"; then
    echo "NG  $file: $label が無い"
    status=1
  fi
}

echo "== 必須メタの確認 =="

while IFS= read -r file; do
  pages=$((pages + 1))

  require "$file" "lang属性" '<html lang="(ja|en)"'
  require "$file" "title" '<title>[^<]+</title>'
  require "$file" "description" '<meta name="description" content="[^"]+"'
  require "$file" "canonical（絶対URL）" '<link rel="canonical" href="https://[^"]+"'
  require "$file" "hreflang=ja" '<link rel="alternate" hreflang="ja" href="https://[^"]+"'
  require "$file" "hreflang=en" '<link rel="alternate" hreflang="en" href="https://[^"]+"'
  require "$file" "hreflang=x-default" '<link rel="alternate" hreflang="x-default" href="https://[^"]+"'
  require "$file" "og:title" '<meta property="og:title" content="[^"]+"'
  require "$file" "og:description" '<meta property="og:description" content="[^"]+"'
  require "$file" "og:image" '<meta property="og:image" content="https://[^"]+"'
  require "$file" "og:url" '<meta property="og:url" content="https://[^"]+"'
  require "$file" "twitter:card" '<meta name="twitter:card" content="[^"]+"'

  # canonical は自己参照でなければならない。og:url と一致しているかで代用して確認する。
  canonical=$(grep -oE '<link rel="canonical" href="[^"]+"' "$file" | sed -E 's/.*href="([^"]+)".*/\1/')
  ogurl=$(grep -oE '<meta property="og:url" content="[^"]+"' "$file" | sed -E 's/.*content="([^"]+)".*/\1/')
  if [ -n "$canonical" ] && [ -n "$ogurl" ] && [ "$canonical" != "$ogurl" ]; then
    echo "NG  $file: canonical と og:url が一致しない（$canonical / $ogurl）"
    status=1
  fi

  # x-default は日本語を指す（SPEC §2.1）
  xdefault=$(grep -oE '<link rel="alternate" hreflang="x-default" href="[^"]+"' "$file" | sed -E 's/.*href="([^"]+)".*/\1/')
  hreflang_ja=$(grep -oE '<link rel="alternate" hreflang="ja" href="[^"]+"' "$file" | sed -E 's/.*href="([^"]+)".*/\1/')
  if [ -n "$xdefault" ] && [ -n "$hreflang_ja" ] && [ "$xdefault" != "$hreflang_ja" ]; then
    echo "NG  $file: x-default が日本語版を指していない（$xdefault）"
    status=1
  fi
done < <(find public -name '*.html' -type f)

echo "  $pages ページを確認した"

echo
if [ "$status" -eq 0 ]; then
  echo "必須メタの欠落は無い。"
else
  echo "必須メタに欠落がある。"
fi
exit "$status"
