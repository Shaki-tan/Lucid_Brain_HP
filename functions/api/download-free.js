// GET /api/download-free
// 無料版は決済確認を行わない。有償版（download.js）とはファイルを分離し、
// 将来の修正で誤って決済チェックが弱まらないようにしている。

export async function onRequestGet(context) {
  const { env } = context

  if (!env.RELEASES) {
    return new Response("Server not configured", { status: 500 })
  }

  const obj = await env.RELEASES.get("latest/Chronos-Free-Setup.exe")
  if (!obj) {
    return new Response("File not found", { status: 404 })
  }

  return new Response(obj.body, {
    headers: {
      "Content-Disposition": 'attachment; filename="Chronos-Free-Setup.exe"',
      "Content-Type": "application/octet-stream",
    },
  })
}
