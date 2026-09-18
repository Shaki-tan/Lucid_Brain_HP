// GET /api/region
//
// 接続元の国コードと、そこが販売対象外かどうかを返す。
// LP 側が購入ボタンを無効化し、決済直前ではなく手前で伝えるために使う（SPEC §8.1）。
//
// 判定の実体は functions/lib/regions.js にあり、/api/checkout と同じ関数を呼ぶ。
// ここが落ちても購入は止まらない。checkout 側が 451 を返すのが本来の防御であり、
// この API はその結果を先に見せるためだけのものである。

import { isBlockedRegion } from '../lib/regions.js'
import { json } from '../lib/http.js'

export async function onRequestGet(context) {
  const country = context.request.cf?.country ?? null
  return json({ country, isBlocked: isBlockedRegion(country) })
}
