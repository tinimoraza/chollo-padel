// scripts/prices/scrapers/time2padel.js
// Time2Padel — PrestaShop, Playwright
//
// NOTA (fix 2026-06-18): URL cambió a /es/5-palas-de-padel (con ID).
// NOTA (fix 2026-07-16): migrado de cheerio+fetch a Playwright — HTTP 403 de Cloudflare.
// NOTA (fix 2026-07-16b): estrategia subcategorías por marca — pero CF bloquea todas
//   las subcategorías en GHA desde la primera visita.
// NOTA (fix 2026-07-16c): nueva estrategia — paginar categoría principal con delay
//   largo (10s) + scrolling simulado. La página principal carga OK; las páginas
//   siguientes también suelen pasar si hay suficiente delay entre ellas.
//   Fallback h2>a si article.product-miniature = 0 (tema personalizado).

const SOURCE_KEY   = 'time2padel'
const BASE_URL     = 'https://www.time2padel.com'
const CATEGORY_URL = `${BASE_URL}/es/5-palas-de-padel`
const PAGE_DELAY   = 10000  // 10s entre páginas — necesario para no disparar CF
const MAX_PAGES    = 50

const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

const EXCLUIR_TITULO = [
  'zapatilla', 'mochila', 'paletero', 'bolsa', 'grip', 'overgrip',
  'pelota', 'pelotas', 'camiseta', 'short', 'polo', 'funda', 'muñequera',
  'protector', 'cordaje', 'antivibrador', 'visera', 'gorra', 'calcetín',
  'ropa', 'pack ', 'muñeq',
]

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR_TITULO.some(w => t.includes(w))
}

async function extractProducts(page) {
  return page.evaluate(function() {
    var items = []
    var seen  = new Set()

    // Intento 1: contenedores estándar PrestaShop
    var articles = Array.from(document.querySelectorAll(
      'article.product-miniature, .product-miniature, .js-product-miniature, li[class*="product-miniature"], div[class*="product-miniature"]'
    ))

    // Intento 2: tema personalizado — inferir contenedor desde h2 > a
    if (articles.length === 0) {
      var h2Links = Array.from(document.querySelectorAll('h2 a[href]'))
        .filter(function(a) { return a.href && a.href.indexOf('#') === -1 && a.textContent && a.textContent.trim().length > 3 })
      var seen2 = new Set()
      for (var k = 0; k < h2Links.length; k++) {
        var a = h2Links[k]
        var container = a.closest('li, article, div[class]') || (a.parentElement && a.parentElement.parentElement)
        if (container && !seen2.has(container)) {
          seen2.add(container)
          articles.push(container)
        }
      }
    }

    for (var i = 0; i < articles.length; i++) {
      var art = articles[i]
      var linkEl = art.querySelector('.product-title a, h2 a, h3 a, .product-name a, a.product-thumbnail')
      if (!linkEl) continue
      var url   = linkEl.href
      var title = linkEl.textContent && linkEl.textContent.trim()
      if (!url || !title || seen.has(url)) continue
      seen.add(url)

      var priceEl = art.querySelector('span.product-price, .price')
      var priceContent = priceEl && priceEl.getAttribute('content')
      var price = priceContent ? parseFloat(priceContent) : NaN
      if (isNaN(price) || price <= 0) {
        var txt = priceEl ? priceEl.textContent.replace(/[^0-9,]/g, '').replace(',', '.') : ''
        price = parseFloat(txt)
      }
      if (isNaN(price) || price < 30) continue

      var origEl   = art.querySelector('span.regular-price, .old-price, del, s')
      var origText = origEl ? origEl.textContent.trim() : ''
      var original = origText
        ? parseFloat(origText.replace(/[^0-9,]/g, '').replace(',', '.'))
        : NaN

      var imgEl = art.querySelector('img[data-src], img')
      var rawImg = imgEl ? (imgEl.getAttribute('data-src') || imgEl.src || '') : ''
      var image = rawImg && !rawImg.startsWith('data:') && rawImg.indexOf('blank.png') === -1
        ? rawImg.split('?')[0]
        : null

      items.push({
        title:           title,
        price:           price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url:             url,
        image:           (image && image.startsWith('http')) ? image : null,
      })
    }
    return items
  })
}

// Devuelve true si la página actual es un challenge de Cloudflare
async function esCloudflarePage(page) {
  try {
    const title = await page.evaluate(function() { return document.title || '' })
    return title.includes('Cloudflare') || title.includes('Attention') ||
           title.includes('Just a moment') || title.includes('Error 1')
  } catch(e) { return false }
}

async function scrape() {
  console.log('[time2padel] Iniciando scraper (Playwright — paginación directa)...')

  var chromium
  try {
    chromium = require('playwright').chromium
  } catch(e) {
    console.error('[time2padel] playwright no instalado')
    return []
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'es-ES',
    extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' },
  })
  await context.addInitScript(function() {
    Object.defineProperty(navigator, 'webdriver', { get: function() { return undefined } })
    Object.defineProperty(navigator, 'plugins', { get: function() { return [1, 2, 3, 4, 5] } })
    window.chrome = { runtime: {} }
  })
  const page = await context.newPage()

  const allProducts = []
  const seen = new Set()
  let codigoDescuento = null
  let rebajasUrls = []

  try {
    // ── Página 1 ─────────────────────────────────────────────────────────────
    console.log('[time2padel]   Cargando página 1...')
    await page.goto(CATEGORY_URL, { waitUntil: 'load', timeout: 45000 })
    await page.waitForTimeout(4000)

    // Cerrar banner cookies
    try {
      await page.waitForSelector(
        '.cmplz-accept, [data-cky-tag="accept-button"], #onetrust-accept-btn-handler, .js-btn-accept-all, .cc-btn',
        { timeout: 5000 }
      )
      await page.click('.cmplz-accept, [data-cky-tag="accept-button"], #onetrust-accept-btn-handler, .js-btn-accept-all, .cc-btn')
      await page.waitForTimeout(1000)
    } catch(e) { /* sin banner */ }

    // CF check
    if (await esCloudflarePage(page)) {
      console.log('[time2padel]   Cloudflare en página 1 — abortando')
      await context.close(); await browser.close()
      return []
    }

    // Código descuento
    const bodyText = await page.evaluate(function() { return document.body.innerText })
    codigoDescuento = detectarCodigoDescuento(bodyText)
    if (codigoDescuento) {
      console.log('[time2padel] codigo: ' + codigoDescuento.codigo + ' (-' + codigoDescuento.descuento_pct + '%)')
    }

    // Secciones rebajas
    const hrefs = await page.evaluate(function() {
      return Array.from(document.querySelectorAll('a[href]')).map(function(a) { return a.href })
    })
    rebajasUrls = filtrarUrlsRebajas(hrefs, CATEGORY_URL).filter(function(u) {
      return !/paletero/i.test(u) && /palas|outlet.*pad|pad.*outlet/i.test(u)
    })

    // Esperar productos pág 1
    try {
      await page.waitForFunction(function() {
        return document.querySelectorAll('article.product-miniature, .product-miniature, .js-product-miniature').length > 0
          || document.querySelectorAll('h2 a[href]').length >= 5
      }, { timeout: 20000 })
    } catch(e) {
      console.log('[time2padel]   Sin productos en página 1 — abortando')
      await context.close(); await browser.close()
      return []
    }

    const p1 = await extractProducts(page)
    for (var i = 0; i < p1.length; i++) {
      var p = p1[i]
      if (!isPala(p.title) || seen.has(p.url)) continue
      seen.add(p.url)
      allProducts.push(p)
    }
    console.log('[time2padel]   Página 1 -> ' + allProducts.length + ' palas')

    // ── Páginas 2+ ──────────────────────────────────────────────────────────
    var pageNum = 2
    while (pageNum <= MAX_PAGES) {
      // Delay largo + scroll simulado para no disparar CF
      await page.waitForTimeout(PAGE_DELAY + Math.floor(Math.random() * 3000))
      try {
        await page.evaluate(function() { window.scrollTo(0, document.body.scrollHeight * 0.7) })
        await page.waitForTimeout(800)
      } catch(e) {}

      const nextUrl = CATEGORY_URL + '?page=' + pageNum
      console.log('[time2padel]   Cargando página ' + pageNum + '...')
      await page.goto(nextUrl, { waitUntil: 'load', timeout: 40000 })
      await page.waitForTimeout(3000)

      if (await esCloudflarePage(page)) {
        console.log('[time2padel]   Cloudflare en página ' + pageNum + ' — deteniendo paginación')
        break
      }

      var gotProds = false
      try {
        await page.waitForFunction(function() {
          return document.querySelectorAll('article.product-miniature, .product-miniature, .js-product-miniature').length > 0
            || document.querySelectorAll('h2 a[href]').length >= 5
        }, { timeout: 15000 })
        gotProds = true
      } catch(e) {}

      if (!gotProds) {
        console.log('[time2padel]   Sin productos en página ' + pageNum + ' — fin')
        break
      }

      const pN = await extractProducts(page)
      var added = 0
      for (var j = 0; j < pN.length; j++) {
        var pj = pN[j]
        if (!isPala(pj.title) || seen.has(pj.url)) continue
        seen.add(pj.url)
        allProducts.push(pj)
        added++
      }
      console.log('[time2padel]   Página ' + pageNum + ' -> ' + added + ' nuevas (total: ' + allProducts.length + ')')

      if (pN.length === 0) break

      // ¿Hay página siguiente?
      var hasNext = false
      try {
        hasNext = await page.evaluate(function(cur) {
          return !!(
            document.querySelector('a[href*="page=' + (cur + 1) + '"]') ||
            document.querySelector('a[rel="next"], .next a, li.next a')
          )
        }, pageNum)
      } catch(e) {}
      if (!hasNext) {
        console.log('[time2padel]   Última página (' + pageNum + ')')
        break
      }

      pageNum++
    }

    // ── Secciones rebajas ────────────────────────────────────────────────────
    for (var ri = 0; ri < rebajasUrls.length; ri++) {
      var rUrl = rebajasUrls[ri]
      await page.waitForTimeout(PAGE_DELAY)
      console.log('[time2padel]   Rebajas: ' + rUrl)
      try {
        await page.goto(rUrl, { waitUntil: 'load', timeout: 40000 })
        await page.waitForTimeout(3000)
        if (await esCloudflarePage(page)) { console.log('[time2padel]   CF en rebajas — saltando'); continue }
        try {
          await page.waitForFunction(function() {
            return document.querySelectorAll('article.product-miniature, .product-miniature, .js-product-miniature').length > 0
              || document.querySelectorAll('h2 a[href]').length >= 5
          }, { timeout: 15000 })
        } catch(e) {}
        const rps = await extractProducts(page)
        var radd = 0
        for (var rj = 0; rj < rps.length; rj++) {
          var rp = rps[rj]
          if (!isPala(rp.title) || seen.has(rp.url)) continue
          seen.add(rp.url)
          allProducts.push(rp)
          radd++
        }
        console.log('[time2padel]   Rebajas ' + rUrl.split('/es/')[1] + ' -> ' + radd + ' nuevas')
      } catch(e) {
        console.error('[time2padel]   Error rebajas ' + rUrl + ':', e.message)
      }
    }

  } catch (err) {
    console.error('[time2padel] Error:', err.message)
  }

  await context.close()
  await browser.close()

  console.log('[time2padel] Total palas unicas: ' + allProducts.length)
  const scraped_at = new Date().toISOString()
  const resultado = allProducts.map(function(p) {
    return {
      source_key:      SOURCE_KEY,
      title:           p.title,
      price:           p.price,
      precio_original: p.precio_original || null,
      url:             p.url,
      image:           p.image || null,
      scraped_at:      scraped_at,
    }
  })
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape: scrape, SOURCE_KEY: SOURCE_KEY }
