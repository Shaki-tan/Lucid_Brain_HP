var langStorageKey = 'chronosLang'

function detectInitialLanguage() {
  var saved = null
  try {
    saved = localStorage.getItem(langStorageKey)
  } catch (err) {
    saved = null
  }
  if (saved === 'ja' || saved === 'en') return saved
  return navigator.language && navigator.language.toLowerCase().indexOf('ja') === 0 ? 'ja' : 'en'
}

function applyLanguage(lang) {
  var dict = i18n[lang] || i18n.ja
  document.documentElement.lang = lang

  var metaDescription = document.querySelector('meta[name="description"]')
  if (metaDescription) metaDescription.setAttribute('content', dict['meta.description'])
  document.title = dict['meta.title']

  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    var key = el.getAttribute('data-i18n')
    if (dict[key] !== undefined) el.textContent = dict[key]
  })
  document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
    var key = el.getAttribute('data-i18n-html')
    if (dict[key] !== undefined) el.innerHTML = dict[key]
  })
  document.querySelectorAll('[data-i18n-alt]').forEach(function (el) {
    var key = el.getAttribute('data-i18n-alt')
    if (dict[key] !== undefined) el.setAttribute('alt', dict[key])
  })
  document.querySelectorAll('[data-i18n-badge]').forEach(function (el) {
    var key = el.getAttribute('data-i18n-badge')
    if (dict[key] !== undefined) el.setAttribute('data-badge', dict[key])
  })
  document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
    var key = el.getAttribute('data-i18n-aria')
    if (dict[key] !== undefined) el.setAttribute('aria-label', dict[key])
  })

  var langJaBtn = document.getElementById('langJa')
  var langEnBtn = document.getElementById('langEn')
  if (langJaBtn) langJaBtn.setAttribute('aria-pressed', String(lang === 'ja'))
  if (langEnBtn) langEnBtn.setAttribute('aria-pressed', String(lang === 'en'))

  try {
    localStorage.setItem(langStorageKey, lang)
  } catch (err) {
    /* localStorage unavailable, ignore */
  }
}

function setupLanguageToggle() {
  var langJaBtn = document.getElementById('langJa')
  var langEnBtn = document.getElementById('langEn')
  if (langJaBtn) langJaBtn.addEventListener('click', function () { applyLanguage('ja') })
  if (langEnBtn) langEnBtn.addEventListener('click', function () { applyLanguage('en') })
  applyLanguage(detectInitialLanguage())
}

function setupScrollReveal() {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var riseEls = document.querySelectorAll('.rise')
  if (reduceMotion || !('IntersectionObserver' in window)) {
    riseEls.forEach(function (el) { el.classList.add('on') })
    return
  }
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('on')
        observer.unobserve(entry.target)
      }
    })
  }, { threshold: 0.12 })
  riseEls.forEach(function (el) { observer.observe(el) })
}

function setupPaidCheckout() {
  var btn = document.getElementById('buyPaidBtn')
  if (!btn) return

  btn.addEventListener('click', function () {
    var lang = document.documentElement.lang === 'en' ? 'en' : 'ja'
    var dict = i18n[lang] || i18n.ja

    btn.disabled = true
    btn.textContent = dict['price.paid.ctaLoading']

    fetch('/api/checkout', { method: 'POST' })
      .then(function (res) {
        if (!res.ok) throw new Error('checkout request failed')
        return res.json()
      })
      .then(function (data) {
        if (!data.url) throw new Error('missing checkout url')
        window.location.href = data.url
      })
      .catch(function () {
        btn.disabled = false
        btn.textContent = dict['price.paid.cta']
        window.alert(dict['price.paid.error'])
      })
  })
}

setupLanguageToggle()
setupScrollReveal()
setupPaidCheckout()
