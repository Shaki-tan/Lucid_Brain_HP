#!/usr/bin/env bash
# 【仮】[TBD] とプレースホルダ資産の残存を検出する（SPEC §2.4 / §7.5）。
#
# 公開前にこれが0件になっていること。実装中は残っているのが正常であり、
# 「いま何が未確定か」を機械的に洗い出すための道具として使う。
#
#   bash tests/check-placeholders.sh

set -uo pipefail
cd "$(dirname "$0")/.."

status=0

# テキストファイルの中の印
report_text() {
  local label="$1"
  local pattern="$2"
  local hits
  # public/ 配下だけを見る。SPEC.md や Tasks/ の記述は対象外。
  hits=$(grep -rIl --fixed-strings -- "$pattern" public/ 2>/dev/null | sort)
  if [ -n "$hits" ]; then
    echo "NG  $label: $(printf '%s\n' "$hits" | wc -l | tr -d ' ') ファイル"
    printf '%s\n' "$hits" | sed 's/^/      /'
    status=1
  else
    echo "OK  $label: 0 ファイル"
  fi
}

# 画像とPDFの中の印。
#   PNG は tEXt チャンクに、PDF は本文に印を焼き込んである（どちらも生成時に埋めている）。
#   --text を付けてバイナリも走査する。実物に差し替われば印ごと消えるので、
#   一覧を手で管理せずに済む。
report_binary() {
  local label="$1"
  local pattern="$2"
  local dir="$3"
  local hits
  hits=$(grep -rl --text --fixed-strings -- "$pattern" "$dir" 2>/dev/null | sort)
  if [ -n "$hits" ]; then
    echo "NG  $label: $(printf '%s\n' "$hits" | wc -l | tr -d ' ') ファイル"
    printf '%s\n' "$hits" | sed 's/^/      /'
    status=1
  else
    echo "OK  $label: 0 ファイル"
  fi
}

echo "== 文言のプレースホルダ =="
report_text "日本語ダミー（【仮】）" "【仮】"
report_text "英語ダミー（[TBD]）" "[TBD]"
report_text "未確定URL（example.com）" "example.com"

echo
echo "== 法務文書の本文に残った未確定の記載・コメント =="
# 法務文書は議論用の原稿（コメントと【 】の未確定の記載を含む）から移す（SPEC §2.2）。
# 【仮】だけを見る上の検査では、原稿の【 】（例: 【登録番号】）が漏れるので、本文の範囲を別に見る
legal_hits=0
while IFS= read -r file; do
  body=$(sed -n '/<article class="legal-body">/,/<\/article>/p' "$file")
  [ -z "$body" ] && continue
  for pattern in '【' '<!--'; do
    count=$(printf '%s\n' "$body" | grep -c --fixed-strings -- "$pattern")
    if [ "$count" -gt 0 ]; then
      echo "NG  $file に「$pattern」が $count 行"
      legal_hits=1
    fi
  done
done < <(grep -rl --fixed-strings 'class="legal-body"' public/ | sort)
if [ "$legal_hits" -eq 0 ]; then
  echo "OK  法務文書の本文に【 】とコメントは無い"
else
  status=1
fi

echo
echo "== Stripe に送る文言のプレースホルダ =="
# 商品名・説明文は products.js から ops.mjs stripe が Stripe に入れ、Checkout と請求書に出る（SPEC §7.6）。
# public/ の外にあるので別に見る
if grep -n --fixed-strings -- "【仮】" functions/lib/products.js >/dev/null 2>&1; then
  echo "NG  functions/lib/products.js に【仮】がある"
  grep -n --fixed-strings -- "【仮】" functions/lib/products.js | sed 's/^/      /'
  status=1
else
  echo "OK  functions/lib/products.js に【仮】は無い"
fi

echo
echo "== 画像・PDFのプレースホルダ =="
report_binary "ロゴ・アイコン・OGP画像" "PLACEHOLDER" "public/assets/images"
report_binary "配布PDF" "[TBD]" "public/docs"

echo
echo "== 差し替え前のダミー画像の参照 =="
# assets/images/placeholder/ は「後で実物を入れる枠」であり、実ページから参照してはならない。
if grep -rIl --fixed-strings -- "/assets/images/placeholder/" public/ >/dev/null 2>&1; then
  echo "NG  ダミー画像を参照しているページがある"
  grep -rIn --fixed-strings -- "/assets/images/placeholder/" public/ | sed 's/^/      /'
  status=1
else
  echo "OK  ダミー画像を参照しているページは無い"
fi

echo
if [ "$status" -eq 0 ]; then
  echo "プレースホルダは残っていない。"
else
  echo "プレースホルダが残っている。公開前に差し替えること（README §9）。"
fi
exit "$status"
