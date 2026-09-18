// 購入同意ダイアログ。制御と日英の文言をここに持つ（SPEC §8.3）。
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
      // 実文は別途準備中。構造を示す例文である（SPEC §2.4 / §8.3）。
      items: [
        {
          label: '【仮】返金ポリシーの内容を確認し、同意します。',
          linkText: '返金ポリシー',
          href: '/legal/refund',
        },
        {
          label: '【仮】ダウンロードを開始した時点で返金を受けられなくなることを承諾します。',
          linkText: '返金ポリシー',
          href: '/legal/refund',
        },
        {
          label: '【仮】特定商取引法に基づく表記を確認しました。',
          linkText: '特定商取引法に基づく表記',
          href: '/legal/tokushoho',
        },
        {
          label: '【仮】本サービスが日本国内の居住者を対象としていることを確認しました。',
          linkText: 'プライバシーポリシー',
          href: '/legal/privacy',
        },
      ],
      snapshotPrefix: 'この同意文言の版:',
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
      items: [
        {
          label: '[TBD] I have read and agree to the Refund Policy.',
          linkText: 'Refund Policy',
          href: '/en/legal/refund',
        },
        {
          label: '[TBD] I accept that I lose the right to a refund once the download starts.',
          linkText: 'Refund Policy',
          href: '/en/legal/refund',
        },
        {
          label: '[TBD] I have read the Legal Notice under the Act on Specified Commercial Transactions.',
          linkText: 'Legal Notice',
          href: '/en/legal/tokushoho',
        },
        {
          label: '[TBD] I confirm that this service is intended for residents of Japan.',
          linkText: 'Privacy Policy',
          href: '/en/legal/privacy',
        },
      ],
      snapshotPrefix: 'Version of this consent text:',
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
  var checkboxes = []
  var submitBtn = null
  var errorEl = null
  var activeTrigger = null

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
    })
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

  function buildDialog(consentVersion) {
    var el = document.createElement('dialog')
    el.className = 'consent-dialog'
    el.id = 'consentDialog'
    // 標準の <dialog> にも明示する（SPEC §8.3）。
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-modal', 'true')
    el.setAttribute('aria-labelledby', 'consentTitle')

    // 版スナップショットは1ファイルに日英を併記するため、URL は言語で分かれない（SPEC §4）。
    var snapshotHref = '/legal/consent/' + consentVersion

    el.innerHTML =
      '<h2 id="consentTitle">' + escapeHtml(t.title) + '</h2>' +
      '<p class="consent-intro">' + escapeHtml(t.intro) + '</p>' +
      '<ul class="consent-items">' + t.items.map(itemMarkup).join('') + '</ul>' +
      '<p class="consent-note">' + escapeHtml(t.snapshotPrefix) +
      ' <a href="' + snapshotHref + '" target="_blank" rel="noopener">' + escapeHtml(consentVersion) +
      '<span class="visually-hidden"> ' + newTabLabel + '</span></a></p>' +
      '<p class="consent-error" id="consentError" role="alert" hidden></p>' +
      '<div class="consent-actions">' +
      '<button type="button" class="btn btn-ghost" data-consent-cancel>' + escapeHtml(t.cancel) + '</button>' +
      '<button type="button" class="btn" id="consentSubmit" aria-disabled="true">' + escapeHtml(t.submit) + '</button>' +
      '</div>'

    document.body.appendChild(el)
    return el
  }

  function syncSubmitState() {
    var isAllChecked = checkboxes.every(function (box) { return box.checked })
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
    activeTrigger = trigger
    if (!dialog) {
      dialog = buildDialog(trigger.dataset.consentVersion)
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
