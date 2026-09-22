// GET /api/download-free?product=pawgress
//
// 無料版は決済確認を行わない。有償版（download.js）とはファイルを分離し、
// 将来の修正で誤って決済チェックが弱まらないようにしている。
//
// 地域判定は入れていない。決済が無いため税務の論点（VAT・GST）は発生しないためである。
// ただし制裁対象国への無償配布と輸出規制、無償利用者に対する GDPR は別問題であり、
// 確認待ちの状態にある（SPEC §8.1 / §10.2 の 8c）。
// 判定を入れると決めた場合は、checkout.js と同じ isBlockedRegion をここでも呼ぶ。

import { resolvePlan } from '../lib/products.js'
import { streamObject } from '../lib/r2.js'
import { toLatestFileName, toLatestKey } from '../lib/releases.js'
import { text } from '../lib/http.js'
import { logError, logInfo } from '../lib/log.js'

const FREE_PLAN = 'free'

export async function onRequestGet(context) {
  const { request, env } = context
  const url = new URL(request.url)
  // 既定値を持たない。プロダクトが増えたとき、省略された URL に別の製品を配らないため
  const productId = url.searchParams.get('product')

  const resolved = resolvePlan(productId, FREE_PLAN)
  if (!resolved) {
    return text('Unknown product', 400)
  }
  const { plan } = resolved

  if (!env.RELEASES) {
    logError('download_free_not_configured', { product: productId })
    return text('Server not configured', 500)
  }

  const key = toLatestKey(productId, plan)
  const response = await streamObject(env.RELEASES, key, toLatestFileName(plan))
  if (!response) {
    logError('download_object_missing', { product: productId, plan: FREE_PLAN, r2_key: key })
    return text('File not found', 404)
  }

  logInfo('download_ok', { product: productId, plan: FREE_PLAN })
  return response
}
