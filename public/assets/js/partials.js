// ヘッダー／フッター。マークアップはこのファイルに1箇所だけ持つ（SPEC §5）。
//
// このスクリプトは <head> で defer を付けずに読み込む。
// パーサが <site-header> に達する前に定義を済ませることで connectedCallback が初回描画より先に走り、
// ちらつきが出ない。fetch もしないため、追加の往復が発生しない。
//
// 文言は URL から言語を判定して出し分ける。i18n の辞書とエンジンは持たない（SPEC §2.1）。
//
// 構成はコーポレート側とプロダクト側で分ける（SPEC §5.2）。判定も URL で行う。
// マークアップを持つファイルは分けない。2組に分かれても、隣に並べて置いたほうが差分が見える。

;(function () {
  'use strict'

  var isEn = location.pathname === '/en' || location.pathname.indexOf('/en/') === 0

  // プロダクトの表示名。増えたらここに足す（決済側の登録は functions/lib/products.js・SPEC §8.2）。
  var PRODUCTS = {
    pawgress: 'Pawgress',
  }

  // /products/<slug>/ 配下にいるか。日英どちらの階層も拾う。
  // 未登録の slug は無視する。登録前のページで名前のないヘッダーを出さないため。
  var productSlug = (function () {
    var matched = location.pathname.match(/^(?:\/en)?\/products\/([^/]+)\//)
    return matched && PRODUCTS[matched[1]] ? matched[1] : null
  })()

  var isProduct = productSlug !== null

  // 言語切替は、対応する別言語の同じページを指す（SPEC §2.1 / §5）。
  // /products/pawgress/ にいるなら /en/products/pawgress/ へ送る。自動リダイレクトはしない。
  function counterpartPath() {
    var path = location.pathname
    if (isEn) {
      var stripped = path.replace(/^\/en(?=\/|$)/, '')
      return stripped === '' ? '/' : stripped
    }
    return path === '/' ? '/en/' : '/en' + path
  }

  var TEXT = {
    ja: {
      home: '/',
      skipToMain: '本文へスキップ',
      brandLabel: 'Lucud Brain トップへ',
      // {name} にプロダクト名が入る
      productBrandLabel: '{name} のページ先頭へ',
      langSwitch: 'English',
      langSwitchLabel: 'Switch to English',
      footerLabel: 'フッター',
      privacy: 'プライバシーポリシー',
      tokushoho: '特定商取引法に基づく表記',
      terms: '利用規約',
      refund: '返金ポリシー',
      legalBase: '/legal/',
      productsBase: '/products/',
    },
    en: {
      home: '/en/',
      skipToMain: 'Skip to main content',
      brandLabel: 'Lucud Brain home',
      productBrandLabel: '{name} page top',
      langSwitch: '日本語',
      langSwitchLabel: '日本語に切り替える',
      footerLabel: 'Footer',
      privacy: 'Privacy Policy',
      tokushoho: 'Legal Notice (Act on Specified Commercial Transactions)',
      terms: 'Terms of Service',
      refund: 'Refund Policy',
      legalBase: '/en/legal/',
      productsBase: '/en/products/',
    },
  }

  var t = isEn ? TEXT.en : TEXT.ja

  // 全ページが日英の対応を持つ。片方しか無いページを作らない（SPEC §2.1）。
  function langSwitchMarkup() {
    var lang = isEn ? 'ja' : 'en'
    return (
      '<a class="lang-switch" href="' + counterpartPath() + '" lang="' + lang +
      '" hreflang="' + lang + '" aria-label="' + t.langSwitchLabel + '">' + t.langSwitch + '</a>'
    )
  }

  // ヘッダーの中身は、左がロゴタイプ、右が言語切替だけとする。どちらの範囲でもこの形は変えない。
  // アイコンは置かない。ブラウザのタブに出るファビコンは各ページの <link rel="icon"> が持つ（SPEC §2.4）。
  // 節への導線は持たない。1枚に3〜4節しかなく、スクロールで足りる（SPEC §6）。
  //
  // 範囲で変わるのはロゴタイプが何を指すかである。
  //   コーポレート側 — 社名。サイトのトップへ送る
  //   プロダクト側   — プロダクト名。そのプロダクトのトップへ送る
  // プロダクトのページで社名を大きく出しても、読み手が見ているものの名前にならない。
  // 会社への導線は、フッターのコピーライトの社名が持つ（下の footerMarkup）。
  function headerMarkup(variant) {
    var brandName = isProduct ? PRODUCTS[productSlug] : 'Lucud Brain'
    var brandHref = isProduct ? t.productsBase + productSlug + '/' : t.home
    var brandLabel = isProduct
      ? t.productBrandLabel.replace('{name}', brandName)
      : t.brandLabel

    return (
      '<header class="site-header"' + (variant ? ' data-variant="' + variant + '"' : '') + '>' +
      '<div class="wrap site-header-inner">' +
      '<a class="brand" href="' + brandHref + '" aria-label="' + brandLabel + '">' +
      '<span class="brand-name">' + brandName + '</span>' +
      '</a>' +
      langSwitchMarkup() +
      '</div>' +
      '</header>'
    )
  }

  function legalLink(slug, label) {
    return '<li><a href="' + t.legalBase + slug + '">' + label + '</a></li>'
  }

  // フッターが持つのは、左にコピーライト、右に legal への導線だけとする。
  // 社名・所在地・連絡先はトップページの CONTACT 節が持つ（SPEC §6.2）。
  //
  // 範囲で変わるのは legal の並びだけである。
  //   コーポレート側 — プライバシーポリシー／特商法表記／利用規約
  //   プロダクト側   — 先頭に返金ポリシーを加える。購入の直前に読む必要があるため（SPEC §8.3）
  function footerMarkup() {
    return (
      '<footer class="site-footer" aria-label="' + t.footerLabel + '">' +
      '<div class="wrap site-footer-inner">' +
      // 年始に古い年号が残るのを防ぐ。平時は保守しないため自動で進める（SPEC §5）。
      //
      // プロダクト側では社名を会社サイトへのリンクにする。ヘッダーがプロダクト名を出しているため、
      // 会社へ戻る導線がここにしかない（SPEC §7.1）。
      // コーポレート側ではリンクにしない。ヘッダーのロゴタイプが同じ名前で同じ先を指しており、
      // 同一画面に「役割 + 名前」が同じリンクを2つ置かないためである（AGENTS.md 3.2）。
      '<p class="site-footer-copy">© ' + new Date().getFullYear() + ' ' +
      (isProduct ? '<a href="' + t.home + '">Lucud Brain</a>' : 'Lucud Brain') +
      '</p>' +
      '<ul class="site-footer-links">' +
      (isProduct ? legalLink('refund', t.refund) : '') +
      legalLink('privacy', t.privacy) +
      legalLink('tokushoho', t.tokushoho) +
      legalLink('terms', t.terms) +
      '</ul>' +
      '</div>' +
      '</footer>'
    )
  }

  // カスタム要素（Custom Elements v1）を前提とする（SPEC §2.3）。
  class SiteHeader extends HTMLElement {
    connectedCallback() {
      this.innerHTML = headerMarkup(this.getAttribute('variant'))
    }
  }

  class SiteFooter extends HTMLElement {
    connectedCallback() {
      this.innerHTML = footerMarkup()
    }
  }

  customElements.define('site-header', SiteHeader)
  customElements.define('site-footer', SiteFooter)

  // 他のスクリプトが言語判定を再実装しなくて済むようにする。
  window.siteLang = isEn ? 'en' : 'ja'
})()
