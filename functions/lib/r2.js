// R2 オブジェクトのストリーム配信（SPEC §4.1）。
//
// バケットは非公開で、配信は Worker 経由のみとする（SPEC §7.5）。
// 公開ディレクトリに exe を置くと、リンクの有無に関わらず直接URLで取得できてしまうため。

// ダウンロードファイル名は Content-Disposition に入る。
// 制御文字・引用符・パス区切りが混ざるとヘッダが壊れるため、安全な文字だけに落とす。
function sanitizeFilename(name) {
  return name.replace(/[^A-Za-z0-9._-]/g, '_')
}

// 見つからなければ null を返す。404 を返すかどうかは呼び出し側が決める。
// ファイル名はアップロード時にオブジェクトへ入れた Content-Disposition（版つき）を使う（SPEC §8.5）。
// 入っていなければ fallbackName（版なし）で返す。
export async function streamObject(bucket, key, fallbackName) {
  const object = await bucket.get(key)
  if (!object) return null

  const headers = new Headers()
  headers.set('Content-Type', 'application/octet-stream')
  headers.set(
    'Content-Disposition',
    object.httpMetadata?.contentDisposition ?? `attachment; filename="${sanitizeFilename(fallbackName)}"`,
  )
  // 認可を通した結果であり、共有キャッシュに載せてはならない。
  headers.set('Cache-Control', 'no-store')
  // R2 が返す長さと ETag を渡し、ブラウザ側の進捗表示と再開を効かせる。
  if (typeof object.size === 'number') headers.set('Content-Length', String(object.size))
  if (object.httpEtag) headers.set('ETag', object.httpEtag)

  return new Response(object.body, { headers })
}
