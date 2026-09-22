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
