// 全ページ共通の初期化。
// ページ固有の振る舞いはここに書かず、そのページの assets/js/ に置く。

;(function () {
  'use strict'

  // スクロールで要素を出す。prefers-reduced-motion のときは最初から出す（SPEC §2.3）。
  function setupScrollReveal() {
    var elements = Array.prototype.slice.call(document.querySelectorAll('.rise'))
    if (elements.length === 0) return

    var isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (isReduced || !('IntersectionObserver' in window)) {
      elements.forEach(function (el) { el.classList.add('is-shown') })
      return
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return
        entry.target.classList.add('is-shown')
        observer.unobserve(entry.target)
      })
    }, { threshold: 0.12 })

    elements.forEach(function (el) { observer.observe(el) })
  }

  function init() {
    setupScrollReveal()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
