// 購入同意ダイアログの仕組み（SPEC §8.3）。
//
// ここが持つのはダイアログの制御と、プロダクトによらない文言（見出し・ボタン・エラー）だけである。
// チェック項目の文言はプロダクトごと・プランごとに変わるため、プロダクト側が持つ。
//   例: public/products/pawgress/assets/js/consent-items.js
//       window.consentItemSets = { <consentSet>: { ja: [...], en: [...] } }
// 購入ボタンの data-consent-set がセット名を指す。名前は functions/lib/products.js の
// plan.consentSet と一致させる（SPEC §8.2）。
//
// 同意チェックは購入ボタンの手前には置かない。ボタンを押してから同意ステップに入り、
// 全項目にチェックが入って初めて「決済に進む」が有効になる。
//
// 文言は日英とも本文と同等の内容とする。§2.2 の「英語は要約」の唯一の例外である。
// ここを要約にすると、EU 消費者権利指令の返品権が残る話に直撃するため。
//
// アクセシビリティは AGENTS.md 3.2 に準拠する。
// 標準の <dialog> を showModal() で開き、フォーカストラップ・Esc・呼び出し元への復帰を
// ブラウザの実装に任せる。div にハンドラを付けない。

;(function () {
  'use strict'

  var isEn = window.siteLang === 'en'

  var TEXT = {
    ja: {
      title: 'ご購入の前に',
      intro: '以下のすべてをご確認のうえ、チェックを入れてください。すべてにチェックが入ると決済に進めます。',
      cancel: 'キャンセル',
      submit: '決済に進む',
      submitting: '決済ページへ移動しています…',
      errorGeneric: '決済ページを開けませんでした。時間をおいてもう一度お試しください。',
      errorRegion: '申し訳ありません。お使いの地域ではご購入いただけません。本サービスは日本国内の居住者を対象としています。',
      errorStale: 'ページが古くなっています。再読み込みのうえ、もう一度お試しください。',
      blockedButton: 'お住まいの地域では購入できません',
    },
    en: {
      title: 'Before you buy',
      intro: 'Please read and check every item below. The payment button becomes available once all are checked.',
      cancel: 'Cancel',
      submit: 'Continue to payment',
      submitting: 'Opening the payment page…',
      errorGeneric: 'We could not open the payment page. Please try again in a moment.',
      errorRegion: 'Sorry — purchases are not available in your region. This service is intended for residents of Japan.',
      errorStale: 'This page is out of date. Please reload and try again.',
      blockedButton: 'Not available in your region',
    },
  }

  var t = isEn ? TEXT.en : TEXT.ja
  var newTabLabel = isEn ? '(opens in a new tab)' : '（別タブで開きます）'

  var dialog = null
  var dialogSet = null
  var checkboxes = []
  var submitBtn = null
  var errorEl = null
  var activeTrigger = null

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
    })
  }

  // プロダクト側が登録した文言を読む。無ければ null を返し、呼び出し側が開くのをやめる。
  function itemsFor(consentSet) {
    var sets = window.consentItemSets
    var set = sets && sets[consentSet]
    var items = set && (isEn ? set.en : set.ja)
    return Array.isArray(items) && items.length > 0 ? items : null
  }

  function itemMarkup(item, index) {
    var id = 'consentItem' + index
    return (
      '<li class="consent-item">' +
      '<input type="checkbox" id="' + id + '">' +
      '<label for="' + id + '">' + escapeHtml(item.label) + ' ' +
      '<a href="' + item.href + '" target="_blank" rel="noopener">' + escapeHtml(item.linkText) +
      '<span class="visually-hidden"> ' + newTabLabel + '</span></a>' +
      '</label>' +
      '</li>'
    )
  }

  function buildDialog(items) {
    var el = document.createElement('dialog')
    el.className = 'consent-dialog'
    el.id = 'consentDialog'
    // 標準の <dialog> にも明示する（SPEC §8.3）。
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-modal', 'true')
    el.setAttribute('aria-labelledby', 'consentTitle')

    // 版（consentVersion）は画面には出さない。読み手に意味のある情報ではないためである。
    // 記録は購入ボタンの data 属性から /api/checkout へ渡り、Stripe に残る（SPEC §8.4）。
    el.innerHTML =
      '<h2 id="consentTitle">' + escapeHtml(t.title) + '</h2>' +
      '<p class="consent-intro">' + escapeHtml(t.intro) + '</p>' +
      '<ul class="consent-items">' + items.map(itemMarkup).join('') + '</ul>' +
      '<p class="consent-error" id="consentError" role="alert" hidden></p>' +
      '<div class="consent-actions">' +
      '<button type="button" class="btn btn-ghost" data-consent-cancel>' + escapeHtml(t.cancel) + '</button>' +
      '<button type="button" class="btn" id="consentSubmit" aria-disabled="true">' + escapeHtml(t.submit) + '</button>' +
      '</div>'

    document.body.appendChild(el)
    return el
  }

  function syncSubmitState() {
    // 0件のときに every() が true を返すのを防ぐ。項目が無いまま決済に進ませない。
    var isAllChecked = checkboxes.length > 0 && checkboxes.every(function (box) { return box.checked })
    // 無効は aria-disabled で公開する。見た目のみで表現しない（SPEC §8.3）。
    submitBtn.setAttribute('aria-disabled', String(!isAllChecked))
  }

  function showError(message) {
    errorEl.textContent = message
    errorEl.hidden = false
  }

  function clearError() {
    errorEl.textContent = ''
    errorEl.hidden = true
  }

  function errorMessageFor(status, code) {
    if (status === 451 || code === 'unavailable_in_region') return t.errorRegion
    if (status === 409 || code === 'consent_version_mismatch') return t.errorStale
    return t.errorGeneric
  }

  async function submitCheckout(trigger) {
    if (submitBtn.getAttribute('aria-disabled') === 'true') return

    clearError()
    submitBtn.setAttribute('aria-disabled', 'true')
    submitBtn.setAttribute('aria-busy', 'true')
    var originalLabel = submitBtn.textContent
    submitBtn.textContent = t.submitting

    try {
      var res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: trigger.dataset.product,
          plan: trigger.dataset.plan,
          consentVersion: trigger.dataset.consentVersion,
          // 参考値。判断には使われない（SPEC §8.4 原則4）。
          consentAtClient: new Date().toISOString(),
        }),
      })

      var data = await res.json().catch(function () { return {} })
      if (!res.ok || !data.url) {
        showError(errorMessageFor(res.status, data.error))
        return
      }
      location.href = data.url
    } catch {
      showError(t.errorGeneric)
    } finally {
      submitBtn.textContent = originalLabel
      submitBtn.removeAttribute('aria-busy')
      syncSubmitState()
    }
  }

  function openDialog(trigger) {
    var consentSet = trigger.dataset.consentSet
    var items = itemsFor(consentSet)

    // 文言が無い状態で開くと、チェックすべき項目が0件のダイアログが出る。
    // プロダクト側のファイルの読み込み忘れか、セット名の綴り違いであり、実装中の事故である。
    // 黙って開かず、購入も始めない。
    if (!items) {
      console.error('consent: 同意項目が見つからない（consentSet=' + consentSet + '）。' +
        'プロダクト側の consent-items.js が読み込まれているか、セット名が products.js と一致しているかを確認する。')
      return
    }

    activeTrigger = trigger

    // 1ページに複数のプラン（買い切りと継続課金など）のボタンが並ぶ場合に備え、
    // セットが変わったら組み直す。使い回すと前のプランの文言が出る。
    if (dialog && dialogSet !== consentSet) {
      dialog.remove()
      dialog = null
    }

    if (!dialog) {
      dialog = buildDialog(items)
      dialogSet = consentSet
      checkboxes = Array.prototype.slice.call(dialog.querySelectorAll('input[type="checkbox"]'))
      submitBtn = dialog.querySelector('#consentSubmit')
      errorEl = dialog.querySelector('#consentError')

      checkboxes.forEach(function (box) { box.addEventListener('change', syncSubmitState) })
      dialog.querySelector('[data-consent-cancel]').addEventListener('click', function () { dialog.close() })
      submitBtn.addEventListener('click', function () { submitCheckout(activeTrigger) })
    }

    checkboxes.forEach(function (box) { box.checked = false })
    clearError()
    syncSubmitState()
    dialog.showModal()
    // 開いたら内部にフォーカスを移す。閉じたときの復帰は <dialog> が行う。
    checkboxes[0].focus()
  }

  // 販売対象外の地域では、決済直前ではなく手前で伝える（SPEC §8.1）。
  // この照会が失敗しても購入は止めない。弾くのは /api/checkout の 451 が本体である。
  async function disableWhenRegionBlocked(triggers) {
    try {
      var res = await fetch('/api/region')
      if (!res.ok) return
      var data = await res.json()
      if (!data.isBlocked) return
      triggers.forEach(function (trigger) {
        trigger.setAttribute('aria-disabled', 'true')
        trigger.disabled = true
        trigger.textContent = t.blockedButton
      })
    } catch {
      /* 判定できないときは何もしない */
    }
  }

  function init() {
    var triggers = Array.prototype.slice.call(document.querySelectorAll('[data-checkout]'))
    if (triggers.length === 0) return

    triggers.forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        if (trigger.getAttribute('aria-disabled') === 'true') return
        openDialog(trigger)
      })
    })

    disableWhenRegionBlocked(triggers)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
