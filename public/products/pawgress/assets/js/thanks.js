// 決済完了ページ。Checkout から戻ってきた session_id でダウンロードを開始する。
//
// インラインスクリプトにしないのは、CSP で unsafe-inline を使わないためである（SPEC §7.5）。
// 文面は HTML 側が日英それぞれ持つ。ここは表示の出し分けとURLの組み立てだけを行う。

;(function () {
  'use strict'

  function init() {
    var params = new URLSearchParams(location.search)
    var sessionId = params.get('session_id')
    var okPanel = document.getElementById('thanksOk')
    var errorPanel = document.getElementById('thanksError')

    if (!sessionId) {
      errorPanel.hidden = false
      return
    }

    // プロダクトとプランは、このページが属するプロダクトのものを HTML から受け取る。
    var panel = okPanel.dataset
    var downloadUrl =
      '/api/download?session_id=' + encodeURIComponent(sessionId) +
      '&product=' + encodeURIComponent(panel.product) +
      '&plan=' + encodeURIComponent(panel.plan)

    document.getElementById('thanksDownloadLink').href = downloadUrl
    okPanel.hidden = false

    location.href = downloadUrl
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
