// 決済完了ページ。Checkout から戻ってきた session_id でダウンロードを開始する。
//
// インラインスクリプトにしないのは、CSP で unsafe-inline を使わないためである（SPEC §7.5）。
// 文面は HTML 側が日英それぞれ持つ。ここは表示の出し分けとURLの組み立てだけを行う。
//
// ダウンロードに失敗すると、/api/download が ?error=<種別> を付けてこのページへ戻す（SPEC §8.1）。
// そのときは session_id が付いていないので、自動ダウンロードは走らない。
// error を先に見るのは、仮に両方が付いていても、エラー → ダウンロード → エラー、を繰り返さないためである。

;(function () {
  'use strict'

  // エラーパネルの種別。functions/api/download.js の ERROR_BY_REASON と一致させる
  var ERRORS = ['missing', 'expired', 'refunded', 'not_found', 'server', 'file']

  // 窓口を案内する種別。期間を過ぎた（expired）ときは申出の期限も過ぎており、
  // 返金済み（refunded）は申し出ることが無いので、窓口を出さない
  var CONTACT_ERRORS = ['missing', 'not_found', 'server', 'file']

  function showError(error) {
    var code = ERRORS.indexOf(error) >= 0 ? error : 'not_found'
    var panel = document.getElementById('thanksError')
    var blocks = panel.querySelectorAll('[data-error]')
    for (var i = 0; i < blocks.length; i++) {
      blocks[i].hidden = blocks[i].getAttribute('data-error') !== code
    }
    document.getElementById('thanksErrorContact').hidden = CONTACT_ERRORS.indexOf(code) < 0
    panel.hidden = false
  }

  function init() {
    var params = new URLSearchParams(location.search)
    var error = params.get('error')
    var sessionId = params.get('session_id')

    if (error) {
      showError(error)
      return
    }
    if (!sessionId) {
      showError('missing')
      return
    }

    var okPanel = document.getElementById('thanksOk')
    // プロダクトとプランは、このページが属するプロダクトのものを HTML から受け取る。
    // 言語は失敗したときの戻り先を決めるために渡す
    var panel = okPanel.dataset
    var downloadUrl =
      '/api/download?session_id=' + encodeURIComponent(sessionId) +
      '&product=' + encodeURIComponent(panel.product) +
      '&plan=' + encodeURIComponent(panel.plan) +
      '&lang=' + encodeURIComponent(document.documentElement.lang)

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
