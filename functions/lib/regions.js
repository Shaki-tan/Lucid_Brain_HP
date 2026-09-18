// 販売しない地域の一覧と判定（SPEC §7.2）。
//
// 閾値がゼロ、つまり1件目から登録・納税義務が生じる地域を弾く。
// 判定は request.cf.country（Cloudflare が付与する接続元の国コード・ISO 3166-1 alpha-2）で行う。
//
// この一覧は2026年9月時点のスナップショットであり、網羅ではない。
// SPEC §7.5 のチェックリスト11番に従い、年1回および下記のタイミングで見直す。
//   - 海外からの購入が実際に発生したとき
//   - 全世界売上が CHF 100,000 に近づいたとき（スイス・シンガポールが一斉に対象化する）
//   - 英語圏への発信を強めるとき

// EU 加盟27か国。デジタルサービスの VAT は購入者所在国の税率で、閾値が無い。
// GDPR と消費者権利指令もここに掛かる。
const EU = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]

// 弾く地域と、その理由。理由を併記するのは、数か月後に「なぜ入っているか」を
// 復元できるようにするためである（SPEC §1.2）。
export const BLOCKED_REGIONS = {
  ...Object.fromEntries(EU.map((code) => [code, 'EU: VAT（閾値なし）／ GDPR ／ 消費者権利指令'])),
  GB: 'UK: VAT（英国外事業者の B2C デジタル供給は閾値なし）／ UK GDPR ／ 消費者法',
  KR: '韓国: VAT（国外事業者の B2C 電子的役務は実質的に閾値なし）',
  IN: 'インド: GST（OIDAR。国外からのデジタル提供は実質的に閾値なし）',
}

// メキシコ（MX・VAT 16%・国外提供者に閾値なし）は SPEC §7.2 の表では閾値ゼロに分類されているが、
// 「本サイトの構え」で弾く対象は EU・UK・韓国・インドの4地域と明記されている。
// 一覧の再確認（SPEC §10.2 の 8 / 8b）で結論が出るまで、ここには入れない。
// 追加する場合はこの行を消して BLOCKED_REGIONS に MX を足す。

export function isBlockedRegion(country) {
  if (typeof country !== 'string') return false
  return Object.prototype.hasOwnProperty.call(BLOCKED_REGIONS, country.toUpperCase())
}

// LP 側で購入ボタンを無効化するために、国コードの一覧だけを返す。
export function blockedRegionCodes() {
  return Object.keys(BLOCKED_REGIONS)
}
