// scripts/prices/scrapers/ofertasdepadel.js
// Scraper Ofertas de Pádel — PrestaShop, Playwright
//
// URL: https://www.ofertasdepadel.com/es/3-palas-de-padel
// ~426 palas; scroll infinito jQuery (ps_infinitescroll)
// PROBLEMA: overflow:hidden en html+body bloquea scroll — html tiene clase sw-open
// FIX: inyectar <style> !important + quitar clase sw-open + disparar evento scroll

const SOURCE_KEY   = 'ofertasdepadel'
const BASE_URL     = 'https://www.ofertasdepadel.com'
const CATEGORY_URL = `${BASE_URL}/es/3-palas-de-padel`
const MAX_SCROLLS  = 130

const { detectarCodigoDescuento } = require('./_discount-utils.js')

const EXCLUIR = [
  'zapatilla', 'mochila', 'paletero', 'bolsa', 'grip', 'overgrip',
  'pelota', 'pelotas', 'camiseta', 'short', 'polo', 'funda',
  'muequera', 'visera', 'gorra', 'calcetines',
  'protector', 'cordaje', 'antivibrador', 'pack ', 'kit ',
  'portabotellas', 'ropa', 'cuerda',
]

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

// Cierra overlays, elimina clases que bloquean scroll, inyecta CSS override
async function liberarScroll(page) {
  const res = await page.evaluate(function() {
    var log = []

    // 1. Intentar cerrar banners de cookies
    var cookieBtns = [
      '#onetrust-accept-btn-handler', '.cmplz-accept',
      '[data-cky-tag="accept-button"]', '.js-btn-accept-all',
      '.cc-btn', '#cookiescript_accept', '#CookieConsent button',
      '[class*="cookie"] button[class*="accept"]',
      '[id*="cookie"] button[class*="accept"]',
      '[class*="cookie"] button[class*="agree"]',
      '[class*="cookie"] .btn', 'button[data-action*="accept"]',
      '.cookie-notice-container button', '#cookie-law-info-bar button',
      '.cli-plugin-button', 'a.cc-btn.cc-allow',
    ]
    for (var i = 0; i < cookieBtns.length; i++) {
      var el = document.querySelector(cookieBtns[i])
      if (el && el.offsetParent !== null) {
        el.click()
        log.push('cookie-btn: ' + cookieBtns[i])
      }
    }

    // 2. Quitar clases del html/body que fuerzan overflow:hidden (sw-open, modal-open, etc.)
    var bad = ['sw-open', 'modal-open', 'no-scroll', 'overflow-hidden', 'menu-open', 'nav-open', 'is-open']
    bad.forEach(function(cls) {
      if (document.documentElement.classList.contains(cls)) {
        document.documentElement.classList.remove(cls)
        log.push('html -' + cls)
      }
      if (document.body.classList.contains(cls)) {
        document.body.classList.remove(cls)
        log.push('body -' + cls)
      }
    })

    // 3. Inyectar <style> con !important para superar cualquier CSS
    if (!document.getElementById('scroll-unlock')) {
      var s = document.createElement('style')
      s.id = 'scroll-unlock'
      s.textContent = 'html,body{overflow:auto!important;overflow-y:auto!important;height:auto!important;}'
      document.head.appendChild(s)
      log.push('injected style !important')
    }

    return {
      log: log,
      htmlClass:    document.documentElement.className.substring(0, 80),
      bodyOverflow: getComputedStyle(document.body).overflowY,
      htmlOverflow: getComputedStyle(document.documentElement).overflowY,
      scrollH:      document.documentElement.scrollHeight,
      clientH:      document.documentElement.clientHeight,
    }
  })
  console.log('[ofertasdepadel]   liberarScroll:', JSON.stringify(res))
  return res
}

async function extractProducts(page) {
  return page.evaluate(function() {
    var items = []
    var seen  = new Set()
    var arts  = Array.from(document.querySelectorAll('article.product-miniature'))
    for (var i = 0; i < arts.length; i++) {
      var el = arts[i]
      var titleEl = el.querySelector('.product-title a, h3.product-title')
      var title   = titleEl ? titleEl.textContent.trim() : ''
      if (!title) continue
      var linkEl = el.querySelector('a.product-thumbnail') || el.querySelector('.product-title a')
      var url    = linkEl ? linkEl.href : ''
      if (!url || url.indexOf('ofertasdepadel.com') === -1) continue
      if (seen.has(url)) continue
      seen.add(url)
      var priceEl   = el.querySelector('span.product-price')
      var origEl    = el.querySelector('span.regular-price')
      var priceText = priceEl ? priceEl.textContent.replace(/[^\d,]/g, '').replace(',', '.') : ''
      var origText  = origEl  ? origEl.textContent.replace(/[^\d,]/g, '').replace(',', '.') : ''
      var price     = parseFloat(priceText)
      var original  = parseFloat(origText)
      if (isNaN(price) || price < 30) continue
      var imgEl  = el.querySelector('a.product-thumbnail img, img')
      var rawImg = imgEl ? (imgEl.getAttribute('data-src') || imgEl.src || '') : ''
      var image  = rawImg && !rawImg.startsWith('data:') ? rawImg.split('?')[0] : null
      items.push({
        title: title, price: price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url: url, image: (image && image.startsWith('http')) ? image : null,
      })
    }
    return items
  })
}

async function scrape() {
  console.log('[ofertasdepadel] Iniciando scraper...')

  var chromium
  try {
    chromium = require('playwright').chromium
  } catch(e) {
    console.error('[ofertasdepadel] playwright no instalado')
    return []
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'es-ES',
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' },
  })
  await context.addInitScript(function() {
    Object.defineProperty(navigator, 'webdriver', { get: function() { return undefined } })
    Object.defineProperty(navigator, 'plugins',   { get: function() { return [1, 2, 3, 4, 5] } })
    window.chrome = { runtime: {} }
  })
  const page = await context.newPage()

  const allProducts = []
  const seen = new Set()
  let codigoDescuento = null

  try {
    console.log('[ofertasdepadel]   Cargando: ' + CATEGORY_URL)
    await page.goto(CATEGORY_URL, { waitUntil: 'load', timeout: 45000 })
    await page.waitForTimeout(3000)

    // Liberar scroll (cierra overlays + quita clases + inyecta CSS)
    await liberarScroll(page)
    await page.waitForTimeout(1200)

    // Esperar primera carga de productos
    try {
      await page.waitForFunction(function() {
        return document.querySelectorAll('article.product-miniature').length > 0
      }, { timeout: 35000 })
    } catch(e) {
      const dbg = await page.evaluate(function() {
        return { title: document.title.substring(0, 80), url: window.location.href }
      }).catch(function() { return {} })
      console.log('[ofertasdepadel]   Sin productos en carga inicial:', JSON.stringify(dbg))
      await context.close()
      await browser.close()
      return []
    }

    const bodyText = await page.evaluate(function() { return document.body.innerText })
    codigoDescuento = detectarCodigoDescuento(bodyText)
    if (codigoDescuento) {
      console.log('[ofertasdepadel] codigo: ' + codigoDescuento.codigo + ' (-' + codigoDescuento.descuento_pct + '%)')
    }

    // Scroll infinito
    console.log('[ofertasdepadel]   Iniciando scroll...')
    let prev = 0, sinCambio = 0
    for (let i = 0; i < MAX_SCROLLS; i++) {
      // Scrollear con todos los métodos disponibles + disparar evento scroll
      const info = await page.evaluate(function() {
        var amount = Math.floor(window.innerHeight * 0.85)
        // Método 1: window.scrollBy
        window.scrollBy(0, amount)
        // Método 2: documentElement.scrollTop (por si scrollBy no mueve)
        document.documentElement.scrollTop += amount
        // Disparar evento scroll para que jQuery/ps_infinitescroll detecte
        window.dispatchEvent(new Event('scroll'))
        document.dispatchEvent(new Event('scroll'))
        if (typeof window.$ !== 'undefined') {
          try { window.$(window).trigger('scroll') } catch(e2) {}
        }
        return {
          scrollY:      window.scrollY,
          docScrollTop: document.documentElement.scrollTop,
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight:  window.innerHeight,
          bodyOverflow: getComputedStyle(document.body).overflowY,
          htmlOverflow: getComputedStyle(document.documentElement).overflowY,
        }
      })
      await page.waitForTimeout(1800)

      const cur = await page.evaluate(function() {
        return document.querySelectorAll('article.product-miniature').length
      })
      const pos      = Math.max(info.scrollY, info.docScrollTop)
      const atBottom = (pos + info.innerHeight + 150) >= info.scrollHeight
      if (cur !== prev) { sinCambio = 0; prev = cur }
      else if (atBottom) {
        sinCambio++
        if (sinCambio >= 3) break
      }
      if (i % 5 === 0 || cur !== prev) {
        console.log('[ofertasdepadel]   scroll ' + i + ': ' + cur + ' arts, Y=' + pos + '/' + info.scrollHeight + ' ovfl=html:' + info.htmlOverflow + '/body:' + info.bodyOverflow)
      }
    }
    console.log('[ofertasdepadel]   Scroll completo: ' + prev + ' articulos')

    const products = await extractProducts(page)
    for (const p of products) {
      if (!isPala(p.title) || seen.has(p.url)) continue
      seen.add(p.url)
      allProducts.push(p)
    }
    console.log('[ofertasdepadel]   Palas extraidas: ' + allProducts.length)

  } catch(err) {
    console.error('[ofertasdepadel] Error:', err.message)
  }

  await context.close()
  await browser.close()

  console.log('[ofertasdepadel] Total palas: ' + allProducts.length)
  const scraped_at = new Date().toISOString()
  const resultado = allProducts.map(function(p) {
    return {
      source_key:      SOURCE_KEY,
      title:           p.title,
      price:           p.price,
      precio_original: p.precio_original != null ? p.precio_original : null,
      url:             p.url,
      image:           p.image != null ? p.image : null,
      scraped_at:      scraped_at,
    }
  })
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
