// scripts/prices/scrapers/allforpadel.js
// AllForPadel — tienda oficial Adidas Pádel en España
// Plataforma: PrestaShop (tema personalizado — contenedor real desconocido)
// URL categoría: https://allforpadel.com/es/54-palas-padel
// Paginación: ?p=N
// Precio: .product-price[content] (entero, ej. "300")
// Nota: PVP oficial Adidas — útil como precio de referencia techo
//
// FIX 2026-07-16 v1: waitForSelector → waitForFunction (h2 a[href] fallback)
// FIX 2026-07-16 v2: article.product-miniature=0 en GHA; fallback h2>a
// FIX 2026-07-16 v3: el contenedor closest() es demasiado pequeño (no contiene
//   el precio); ahora subimos en el DOM hasta encontrar un ancestro que tenga
//   tanto título como .product-price.

const SOURCE_KEY = 'allforpadel'
const BASE_URL   = 'https://allforpadel.com/es/54-palas-padel'
const DELAY_MS   = 2000

const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

async function extractProducts(page) {
  return page.evaluate(function() {
    var items = []
    var seen  = new Set()

    // Intento 1: contenedores estándar PrestaShop
    var articles = Array.from(document.querySelectorAll(
      'article.product-miniature, .product-miniature, .js-product-miniature, li[class*="product-miniature"], div[class*="product-miniature"]'
    ))

    // Intento 2: tema personalizado — subir DOM desde h2 > a hasta ancestro con precio
    if (articles.length === 0) {
      var h2Links = Array.from(document.querySelectorAll('h2 a[href]'))
        .filter(function(a) {
          return a.href
            && a.href.indexOf('#') === -1
            && a.href.indexOf('allforpadel.com') !== -1
            && a.textContent && a.textContent.trim().length > 3
        })
      var seen2 = new Set()
      for (var k = 0; k < h2Links.length; k++) {
        var a = h2Links[k]
        // Subir en el DOM hasta encontrar un ancestro que contenga un precio
        var container = null
        var el = a.parentElement
        for (var depth = 0; depth < 10; depth++) {
          if (!el || el === document.body) break
          if (el.querySelector('span.product-price, .product-price, [itemprop="price"]')) {
            container = el
            break
          }
          el = el.parentElement
        }
        // Fallback si no encontramos precio: usar closest genérico
        if (!container) {
          container = a.closest('li, article, div[class]') || (a.parentElement && a.parentElement.parentElement)
        }
        if (container && !seen2.has(container)) {
          seen2.add(container)
          articles.push(container)
        }
      }
    }

    for (var i = 0; i < articles.length; i++) {
      var art = articles[i]
      var linkEl = art.querySelector('h2 a, .product-title a, h3 a, a.product-thumbnail')
      if (!linkEl) continue
      var url   = linkEl.href
      var title = linkEl.textContent && linkEl.textContent.trim()
      if (!url || !title || seen.has(url)) continue
      seen.add(url)

      // Precio: .product-price[content] = entero sin decimales (ej. "300")
      var price = NaN
      var priceContentEl = art.querySelector('.product-price[content], [itemprop="price"]')
      if (priceContentEl) {
        var c = priceContentEl.getAttribute('content')
        if (c) price = parseFloat(c)
      }
      if (isNaN(price) || price <= 0) {
        var priceTextEl = art.querySelector('.product-price, .price')
        var txt = priceTextEl ? priceTextEl.textContent.replace(/[^0-9,]/g, '').replace(',', '.') : ''
        price = parseFloat(txt)
      }
      if (isNaN(price) || price < 30) continue

      // Precio original (tachado)
      var origEl = art.querySelector('.regular-price, .old-price, s, del')
      var original = NaN
      if (origEl) {
        var oc = origEl.getAttribute('content')
        var otxt = oc || origEl.textContent.replace(/[^0-9,]/g, '').replace(',', '.')
        var v = parseFloat(otxt)
        if (!isNaN(v) && v > price) original = v
      }

      // Imagen: data-src lazy
      var imgEl = art.querySelector('img[data-src], img')
      var rawImg = (imgEl && (imgEl.getAttribute('data-src') || imgEl.src)) || ''
      var image = rawImg && !rawImg.startsWith('data:') && rawImg.indexOf('blank.png') === -1
        ? rawImg.split('?')[0]
        : null

      items.push({
        title: title,
        price: price,
        precio_original: !isNaN(original) ? original : null,
        url: url,
        image: (image && image.startsWith('http')) ? image : null,
      })
    }

    return items
  })
}

async function scrape() {
  console.log('[allforpadel] Iniciando scraper (PrestaShop — Adidas oficial)...')

  var chromium
  try {
    chromium = require('playwright').chromium
  } catch (e) {
    console.error('[allforpadel] playwright no instalado — npm install playwright')
    return []
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
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
  let pageNum = 1
  let codigoDescuento = null
  let rebajasUrls = []

  try {
    while (true) {
      const url = pageNum === 1 ? BASE_URL : BASE_URL + '?p=' + pageNum
      console.log('[allforpadel] Pagina ' + pageNum + ': ' + url)

      await page.goto(url, { waitUntil: 'load', timeout: 45000 })
      await page.waitForTimeout(3000)

      // Cerrar cookies/popup
      if (pageNum === 1) {
        try {
          await page.waitForSelector(
            '.cmplz-accept, [data-cky-tag="accept-button"], .cc-btn, #onetrust-accept-btn-handler, .js-btn-accept-all',
            { timeout: 5000 }
          )
          await page.click('.cmplz-accept, [data-cky-tag="accept-button"], .cc-btn, #onetrust-accept-btn-handler, .js-btn-accept-all')
          await page.waitForTimeout(1000)
        } catch (e) { /* sin banner */ }
      }

      // Esperar productos: estándar PrestaShop o h2 a[href] >= 5
      var gotProducts = false
      try {
        await page.waitForFunction(function() {
          return document.querySelectorAll(
            'article.product-miniature, .product-miniature, .js-product-miniature'
          ).length > 0 || document.querySelectorAll('h2 a[href]').length >= 5
        }, { timeout: 30000 })
        gotProducts = true
      } catch (e) {
        var debugInfo = {}
        try {
          debugInfo = await page.evaluate(function() {
            return {
              url: window.location.href,
              title: document.title.substring(0, 100),
              h2count: document.querySelectorAll('h2').length,
              h2links: document.querySelectorAll('h2 a[href]').length,
              priceCount: document.querySelectorAll('.product-price, [itemprop="price"]').length,
            }
          })
        } catch(e2) {}
        console.log('[allforpadel] Sin productos en pagina ' + pageNum + ' — fin', debugInfo)
        break
      }

      if (pageNum === 1) {
        const bodyText = await page.evaluate(function() { return document.body.innerText })
        codigoDescuento = detectarCodigoDescuento(bodyText)
        if (codigoDescuento) {
          console.log('[allforpadel] codigo detectado: ' + codigoDescuento.codigo + ' (-' + codigoDescuento.descuento_pct + '%)')
        }
        const hrefs = await page.evaluate(function() {
          return Array.from(document.querySelectorAll('a[href]')).map(function(a) { return a.href })
        })
        rebajasUrls = filtrarUrlsRebajas(hrefs, BASE_URL)
        if (rebajasUrls.length > 0) {
          console.log('[allforpadel] seccion(es) de rebajas: ' + rebajasUrls.join(', '))
        }
      }

      // Debug antes de extraer
      const debugPre = await page.evaluate(function() {
        return {
          h2links: document.querySelectorAll('h2 a[href]').length,
          priceCount: document.querySelectorAll('.product-price, [itemprop="price"]').length,
          miniature: document.querySelectorAll('article.product-miniature, .product-miniature').length,
        }
      })
      console.log('[allforpadel] debug pag' + pageNum + ':', JSON.stringify(debugPre))

      const products = await extractProducts(page)
      console.log('[allforpadel]  -> ' + products.length + ' palas')

      if (products.length === 0) break
      allProducts.push.apply(allProducts, products)

      // Hay pagina siguiente?
      const hasNext = await page.evaluate(function(cur) {
        return !!(
          document.querySelector('a[href*="?p=' + (cur + 1) + '"]') ||
          document.querySelector('a[href*="p=' + (cur + 1) + '"]') ||
          document.querySelector('a[rel="next"], .next a, li.next a')
        )
      }, pageNum)

      if (!hasNext) {
        console.log('[allforpadel] Ultima pagina (' + pageNum + '). Total: ' + allProducts.length)
        break
      }

      pageNum++
      await page.waitForTimeout(DELAY_MS)
    }
  } catch (err) {
    console.error('[allforpadel] Error:', err.message)
  }

  // Secciones de rebajas
  for (var ri = 0; ri < rebajasUrls.length; ri++) {
    var rebajasUrl = rebajasUrls[ri]
    try {
      console.log('[allforpadel] Rebajas: ' + rebajasUrl)
      await page.goto(rebajasUrl, { waitUntil: 'load', timeout: 45000 })
      await page.waitForTimeout(2000)
      try {
        await page.waitForFunction(function() {
          return document.querySelectorAll(
            'article.product-miniature, .product-miniature, .js-product-miniature'
          ).length > 0 || document.querySelectorAll('h2 a[href]').length >= 5
        }, { timeout: 15000 })
      } catch(e) { /* sin productos en rebajas */ }
      const rproducts = await extractProducts(page)
      console.log('[allforpadel]  -> ' + rproducts.length + ' productos')
      allProducts.push.apply(allProducts, rproducts)
    } catch (e) {
      console.error('[allforpadel] Error rebajas ' + rebajasUrl + ':', e.message)
    }
    await page.waitForTimeout(DELAY_MS)
  }

  await context.close()
  await browser.close()

  // Deduplicar por URL
  var seen2  = new Set()
  var unique = allProducts.filter(function(p) {
    if (seen2.has(p.url)) return false
    seen2.add(p.url)
    return true
  })

  console.log('[allforpadel] Total palas unicas: ' + unique.length)

  const scraped_at = new Date().toISOString()
  const resultado = unique.map(function(p) {
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

module.exports = { scrape: scrape, SOURCE_KEY: SOURCE_KEY }
