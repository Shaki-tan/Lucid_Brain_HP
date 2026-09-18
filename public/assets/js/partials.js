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
    blog: 'https://note.com/example',
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
      navManifesto: 'ミッション',
      navBusiness: '事業内容',
      navProducts: 'プロダクト',
      navCompany: '会社概要',
      navContact: 'お問い合わせ',
      langSwitch: 'English',
      langSwitchLabel: 'Switch to English',
      footerLabel: 'フッター',
      privacy: 'プライバシーポリシー',
      tokushoho: '特定商取引法に基づく表記',
      refund: '返金ポリシー',
      blog: 'ブログ（外部サイト）',
      socialX: 'X でお問い合わせ',
      socialMail: 'メールでお問い合わせ',
      scope: '本サービスは日本国内の居住者を対象としています。価格はすべて円（JPY）表示です。',
      legalBase: '/legal/',
      productsBase: '/products/',
    },
    en: {
      home: '/en/',
      skipToMain: 'Skip to main content',
      brandLabel: 'Lucud Brain home',
      navLabel: 'Site navigation',
      navManifesto: 'Mission',
      navBusiness: 'What we do',
      navProducts: 'Products',
      navCompany: 'Company',
      navContact: 'Contact',
      langSwitch: '日本語',
      langSwitchLabel: '日本語に切り替える',
      footerLabel: 'Footer',
      privacy: 'Privacy Policy',
      tokushoho: 'Legal Notice (Act on Specified Commercial Transactions)',
      refund: 'Refund Policy',
      blog: 'Blog (external site)',
      socialX: 'Contact us on X',
      socialMail: 'Contact us by email',
      scope: 'This service is intended for residents of Japan. All prices are shown in Japanese yen (JPY).',
      legalBase: '/en/legal/',
      productsBase: '/en/products/',
    },
  }

  var t = isEn ? TEXT.en : TEXT.ja

  // 【仮】猫モチーフのロゴ。ロゴ確定まで流用する（SPEC §2.4）。
  // 破線の枠と「仮」のバッジを重ね、暫定のロゴであることが画面上で分かるようにしてある。
  // 確定したロゴに差し替えるときは、この定数と public/assets/images/logo/favicon.svg を置き換え、
  // この行の【仮】も消す（tests/check-placeholders.sh が拾う印になっている）。
  var BRAND_MARK =
    '<svg class="brand-mark" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"' +
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="1" y="1" width="30" height="30" rx="7" stroke="#f3a15c" stroke-width="1.4"' +
    ' stroke-dasharray="3 2.5"/>' +
    '<path d="M9 8 L12 13.5"/><path d="M23 8 L20 13.5"/>' +
    '<path d="M10 13.5c0-3 2.7-4.6 6-4.6s6 1.6 6 4.6v5.2c0 3.4-2.8 6-6 6s-6-2.6-6-6v-5.2z"/>' +
    '<circle cx="13.6" cy="17.1" r="0.6" fill="currentColor"/>' +
    '<circle cx="18.4" cy="17.1" r="0.6" fill="currentColor"/>' +
    '<path d="M14.6 19.9c.9.9 1.9.9 2.8 0"/>' +
    '<circle cx="25" cy="25" r="6" fill="#f3a15c" stroke="none"/>' +
    '<text x="25" y="25" font-family="sans-serif" font-size="8" font-weight="700" fill="#0b0a10"' +
    ' stroke="none" text-anchor="middle" dominant-baseline="central">仮</text>' +
    '</svg>'

  function headerMarkup(variant) {
    return (
      '<header class="site-header"' + (variant ? ' data-variant="' + variant + '"' : '') + '>' +
      '<div class="wrap site-header-inner">' +
      '<a class="brand" href="' + t.home + '" aria-label="' + t.brandLabel + '">' +
      BRAND_MARK +
      '<span class="brand-name">Lucud Brain</span>' +
      '</a>' +
      '<nav class="site-nav" aria-label="' + t.navLabel + '">' +
      '<ul class="site-nav-links">' +
      '<li><a href="' + t.home + '#manifesto">' + t.navManifesto + '</a></li>' +
      '<li><a href="' + t.home + '#business">' + t.navBusiness + '</a></li>' +
      '<li><a href="' + t.productsBase + 'pawgress/">' + t.navProducts + '</a></li>' +
      '<li><a href="' + t.home + '#company">' + t.navCompany + '</a></li>' +
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
      '<ul class="site-footer-links">' +
      '<li><a href="' + t.legalBase + 'privacy">' + t.privacy + '</a></li>' +
      '<li><a href="' + t.legalBase + 'tokushoho">' + t.tokushoho + '</a></li>' +
      '<li><a href="' + t.legalBase + 'refund">' + t.refund + '</a></li>' +
      '<li><a href="' + LINKS.blog + '" rel="noopener external">' + t.blog + '</a></li>' +
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
