// 配布ファイルの R2 上の置き場所（SPEC §8.5）。
// キーはプロダクトIDとレジストリの releaseFile（ファイル名の型）から組む。どこにも書き写さない。
//
//   <product>/latest/<型から -{version} を除いた名前>   Worker が配るもの。版を上げるたびに上書きする
//   <product>/<version>/<型に版を入れた名前>            版ごとの控え。上書きしない
//
//   例: pawgress/latest/Pawgress-Windows-Setup.exe
//       pawgress/1.0.1/Pawgress-Windows-1.0.1-Setup.exe
//
// 購入者が受け取るファイル名（版つき）は、アップロード時にオブジェクトの Content-Disposition に入れる。
// latest のキーに版を入れないのは、版を上げるたびに Worker のデプロイが要る形を避けるためである。

const VERSION = '{version}'

// 1.0.1 / 1.2.0-beta.1 の形
const VERSION_PATTERN = '(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.]+)?)'

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function toReleaseFileName(plan, version) {
  return plan.releaseFile.replace(VERSION, version)
}

export function toLatestFileName(plan) {
  return plan.releaseFile.replace(`-${VERSION}`, '')
}

export function toLatestKey(productId, plan) {
  return `${productId}/latest/${toLatestFileName(plan)}`
}

export function toVersionKey(productId, plan, version) {
  return `${productId}/${version}/${toReleaseFileName(plan, version)}`
}

// ファイル名が型に合えば版を返す。合わなければ null（無料版と有償版の取り違えもここで弾ける）
export function parseReleaseVersion(plan, fileName) {
  const [head, tail] = plan.releaseFile.split(VERSION)
  const pattern = new RegExp(`^${escapeRegExp(head)}${VERSION_PATTERN}${escapeRegExp(tail)}$`)
  return pattern.exec(fileName)?.[1] ?? null
}
