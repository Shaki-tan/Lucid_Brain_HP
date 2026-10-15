// レスポンス生成とエラー整形。各ハンドラで同じ形を書かないための小物（SPEC §4.1）。

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }

// API のレスポンスはキャッシュさせない。決済・認可に関わるため。
const NO_STORE = { 'Cache-Control': 'no-store' }

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...NO_STORE, ...headers },
  })
}

// エラーの本体は常に { error: '<種別>' } の形にする。
// 種別はクライアントが分岐に使うため、内部事情（Stripe のメッセージ等）は載せない。
export function error(code, status) {
  return json({ error: code }, status)
}

export function text(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...NO_STORE, ...headers },
  })
}

// 同じサイトの別のページへ戻す。location はルート相対のパスを渡す
export function redirect(location, status = 302) {
  return new Response(null, { status, headers: { Location: location, ...NO_STORE } })
}

// ページ遷移（リンクのクリック・location.href・アドレスバー）として要求されたか。
// fetch や curl には付かないので、人に見せる応答とテキストの応答を分けるのに使う（SPEC §8.1）
export function isNavigation(request) {
  return request.headers.get('Sec-Fetch-Mode') === 'navigate'
}

// /api/checkout の濫用対策（SPEC §7.5）。自サイト以外からの呼び出しを拒否する。
// Origin が無いリクエスト（curl 等）も拒否する。ブラウザからの正規の POST には必ず付く。
export function isSameOrigin(request) {
  const origin = request.headers.get('Origin')
  if (!origin) return false
  try {
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}
