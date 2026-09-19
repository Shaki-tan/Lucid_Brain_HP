// 共通ヘッダー／フッター。マークアップはこのファイルに1箇所だけ持つ（SPEC §5）。
//
// このスクリプトは <head> で defer を付けずに読み込む。
// パーサが <site-header> に達する前に定義を済ませることで connectedCallback が初回描画より先に走り、
// ちらつきが出ない。fetch もしないため、追加の往復が発生しない。
//
// 文言は URL から言語を判定して出し分ける。i18n の辞書とエンジンは持たない（SPEC §2.1）。

;(function () {
  'use strict'

  // 公開前に実URLへ差し替える（SPEC §10.1）。example.com のまま公開しないこと。
  // 差し替え漏れは tests/check-placeholders.sh が検出する。
  var LINKS = {
    note: 'https://note.com/example',
    x: 'https://x.com/example',
    mail: 'mailto:info@example.com',
  }

  var isEn = location.pathname === '/en' || location.pathname.indexOf('/en/') === 0

  // 同意文言のスナップショットは1ファイルに日英を併記するため、対応ページを持たない（SPEC §8.4）。
  // 切替リンクを出すと存在しないURLへ送ることになるので、このページでは出さない。
  function hasCounterpart() {
    return location.pathname.indexOf('/legal/consent/') !== 0
  }

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
      navLabel: 'サイト内ナビゲーション',
      navAbout: '私たちについて',
      navBusiness: '事業内容',
      navProducts: 'プロダクト',
      langSwitch: 'English',
      langSwitchLabel: 'Switch to English',
      footerLabel: 'フッター',
      // 会社概要は本文に節を持たず、ここに置く。法的実体の確定後に差し替える（SPEC §10.1）
      companyHeading: '会社名',
      companyName: '【仮】正式名称（法的実体の確定後に差し替え）',
      addressHeading: '所在地',
      address: '【仮】所在地',
      representativeHeading: '代表者',
      representative: '【仮】代表者名',
      foundedHeading: '設立',
      founded: '【仮】設立年月',
      privacy: 'プライバシーポリシー',
      tokushoho: '特定商取引法に基づく表記',
      refund: '返金ポリシー',
      socialX: 'X（外部サイト）',
      socialMail: 'メールでお問い合わせ',
      socialNote: 'note（外部サイト）',
      scope: '本サービスは日本国内の居住者を対象としています。価格はすべて円（JPY）表示です。',
      legalBase: '/legal/',
      productsBase: '/products/',
    },
    en: {
      home: '/en/',
      skipToMain: 'Skip to main content',
      brandLabel: 'Lucud Brain home',
      navLabel: 'Site navigation',
      navAbout: 'About us',
      navBusiness: 'What we do',
      navProducts: 'Products',
      langSwitch: '日本語',
      langSwitchLabel: '日本語に切り替える',
      footerLabel: 'Footer',
      companyHeading: 'Name',
      companyName: '[TBD] Registered name (to be replaced once the legal entity is settled)',
      addressHeading: 'Address',
      address: '[TBD] Address',
      representativeHeading: 'Representative',
      representative: '[TBD] Name of the representative',
      foundedHeading: 'Founded',
      founded: '[TBD] Year and month',
      privacy: 'Privacy Policy',
      tokushoho: 'Legal Notice (Act on Specified Commercial Transactions)',
      refund: 'Refund Policy',
      socialX: 'X (external site)',
      socialMail: 'Contact us by email',
      socialNote: 'note (external site)',
      scope: 'This service is intended for residents of Japan. All prices are shown in Japanese yen (JPY).',
      legalBase: '/en/legal/',
      productsBase: '/en/products/',
    },
  }

  var t = isEn ? TEXT.en : TEXT.ja

  // ヘッダーにはアイコンを置かず、社名のロゴタイプだけを出す。
  // ブラウザのタブに出るファビコンは各ページの <link rel="icon"> が持つ（差し替えは SPEC §2.4）。
  function headerMarkup(variant) {
    return (
      '<header class="site-header"' + (variant ? ' data-variant="' + variant + '"' : '') + '>' +
      '<div class="wrap site-header-inner">' +
      '<a class="brand" href="' + t.home + '" aria-label="' + t.brandLabel + '">' +
      '<span class="brand-name">Lucud Brain</span>' +
      '</a>' +
      '<nav class="site-nav" aria-label="' + t.navLabel + '">' +
      '<ul class="site-nav-links">' +
      '<li><a href="' + t.home + '#about">' + t.navAbout + '</a></li>' +
      '<li><a href="' + t.home + '#business">' + t.navBusiness + '</a></li>' +
      '<li><a href="' + t.productsBase + 'pawgress/">' + t.navProducts + '</a></li>' +
      '</ul>' +
      (hasCounterpart()
        ? '<a class="lang-switch" href="' + counterpartPath() + '" lang="' + (isEn ? 'ja' : 'en') +
          '" hreflang="' + (isEn ? 'ja' : 'en') + '" aria-label="' + t.langSwitchLabel + '">' +
          t.langSwitch + '</a>'
        : '') +
      '</nav>' +
      '</div>' +
      '</header>'
    )
  }

  function footerMarkup() {
    return (
      '<footer class="site-footer" aria-label="' + t.footerLabel + '">' +
      '<div class="wrap">' +
      '<div class="site-footer-inner">' +
      // 会社概要。本文に節を持たせず、ここに1箇所だけ置く（SPEC §6 の表・6行目）
      '<div class="site-footer-company">' +
      '<p class="site-footer-brand">Lucud Brain</p>' +
      '<dl class="site-footer-meta">' +
      '<dt>' + t.companyHeading + '</dt><dd>' + t.companyName + '</dd>' +
      '<dt>' + t.addressHeading + '</dt><dd>' + t.address + '</dd>' +
      '<dt>' + t.representativeHeading + '</dt><dd>' + t.representative + '</dd>' +
      '<dt>' + t.foundedHeading + '</dt><dd>' + t.founded + '</dd>' +
      '</dl>' +
      '</div>' +
      '<div class="site-footer-nav">' +
      '<ul class="site-footer-links">' +
      '<li><a href="' + t.legalBase + 'privacy">' + t.privacy + '</a></li>' +
      '<li><a href="' + t.legalBase + 'tokushoho">' + t.tokushoho + '</a></li>' +
      '<li><a href="' + t.legalBase + 'refund">' + t.refund + '</a></li>' +
      '</ul>' +
      '<div class="site-footer-social">' +
      '<a href="' + LINKS.x + '" rel="noopener external" aria-label="' + t.socialX + '">' +
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M18.9 2h3.3l-7.2 8.2L23.4 22h-6.6l-5.2-6.8L5.6 22H2.3l7.7-8.8L1.6 2h6.8l4.7 6.2L18.9 2zm-1.2 18h1.8L7.4 3.9H5.5L17.7 20z"/>' +
      '</svg></a>' +
      '<a href="' + LINKS.mail + '" aria-label="' + t.socialMail + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"' +
      ' stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M4 6l8 7 8-7"/></svg>' +
      '</a>' +
      // note は小文字の n をかたどった線画で表す（ブログは外部サービスに置く・SPEC §7.3）
      '<a href="' + LINKS.note + '" rel="noopener external" aria-label="' + t.socialNote + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
      ' stroke-linejoin="round" aria-hidden="true"><path d="M8 17V8"/>' +
      '<path d="M8 11.6c0-2.1 1.7-3.6 4-3.6s4 1.5 4 3.6V17"/></svg>' +
      '</a>' +
      '</div>' +
      '</div>' +
      '</div>' +
      // 販売対象地域の明記。legal・同意ダイアログと合わせて3箇所に置く（SPEC §7.2）
      '<p class="site-footer-scope">' + t.scope + '</p>' +
      // 年始に古い年号が残るのを防ぐ。平時は保守しないため自動で進める（SPEC §5）
      '<p class="site-footer-copy">© ' + new Date().getFullYear() + ' Lucud Brain</p>' +
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
