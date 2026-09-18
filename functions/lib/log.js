// 構造化ログ。1行1JSON で出し、Workers Logs でフィールド検索できるようにする（SPEC §8.4）。
//
// ここに入れてよいのは障害調査に要るものだけである。法的に意味を持つ記録は Stripe に置く。
// Workers Logs の保持は無料3日・有料7日しかなく、消えて困るものを入れてはならない。
// 氏名・メール・IP は書かない。Stripe が持っているため、二重に持つと管理対象が増えるだけである。

function emit(level, event, fields) {
  // 時刻はサーバ側で採る（SPEC §8.4 原則4）。
  console.log(JSON.stringify({ level, event, at: new Date().toISOString(), ...fields }))
}

export function logInfo(event, fields = {}) {
  emit('info', event, fields)
}

export function logError(event, fields = {}) {
  emit('error', event, fields)
}

// session_id をそのまま残さず、末尾数桁だけにする（SPEC §8.4）。
// 問い合わせの突き合わせには足り、ログ単体ではダウンロードできない。
export function sessionTail(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null
  return sessionId.slice(-6)
}
