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

  // ヒーロー背景を背面に通すヘッダー（トップページ・components.css の [data-variant="hero"]）。
  // 最上部では面を持たず、スクロールされたらヒーロー画像の色で面を作る。
  //
  // 切替点はヘッダー1つぶんの高さとする。ヒーローの下端まで待つ手もあるが、それをすると
  // 面のないヘッダーの白い文字と、スクロールで上がってくる h1 の白い文字が重なって、
  // どちらも読めない時間ができる。ヒーローの中にいるあいだも面を出しておく。
  //
  // 0 超で切り替えないのは、最上部での「画像に溶けたヘッダー」がひと目で消えないようにするため。
  // 切替点の 68px まで上げても、ヒーローの最初の要素（.eyebrow）はまだヘッダーに届かない。
  function setupHeroHeader() {
    var header = document.querySelector('.site-header[data-variant="hero"]')
    if (!header) return

    var isTicking = false

    function update() {
      isTicking = false
      var isScrolled = window.pageYOffset > header.offsetHeight
      header.setAttribute('data-scrolled', isScrolled ? 'true' : 'false')
    }

    function onScroll() {
      if (isTicking) return
      isTicking = true
      window.requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
  }

  function init() {
    setupScrollReveal()
    setupHeroHeader()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
