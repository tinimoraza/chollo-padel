// scripts/prices/scrapers/time2padel.js
// Time2Padel — PrestaShop, Playwright
//
// NOTA (fix 2026-06-18): URL cambió a /es/5-palas-de-padel (con ID).
// NOTA (fix 2026-07-16): migrado de cheerio+fetch a Playwright — HTTP 403 de Cloudflare.
// NOTA (fix 2026-07-17): DOM-walker primario — article.product-miniature solo contiene imagen.
// NOTA (fix 2026-07-17c): scroll infinito — la tienda carga productos a medida que
//   se hace scroll; no hay paginación clásica ni ?page=N.

const SOURCE_KEY   = 'time2padel'
const BASE_URL     = 'https://www.time2padel.com'
const CATEGORY_URL = `${BASE_URL}/es/5-palas-de-padel`
const SCROLL_DELAY = 1800  // ms entre cada scroll — tiempo para lazy-load
const MAX_SCROLLS  = 80    // límite de seguridad (446 palas / ~6 por scroll = ~75)

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

// Scroll incremental hasta cargar todos los productos (scroll infinito)
// Usa scrollBy(0, innerHeight) en lugar de scrollTo(bottom) para que el
// IntersectionObserver del sitio se dispare al pasar por cada elemento.
async function scrollHastaCargarTodo(page, label) {
  label = label || ''
  var prev = 0
  var sinCambio = 0
  var posY = 0

  for (var i = 0; i < MAX_SCROLLS; i++) {
    // Scroll por un viewport completo hacia abajo
    var info = await page.evaluate(function() {
      window.scrollBy(0, window.innerHeight)
      return {
        scrollY:      window.scrollY,
        innerHeight:  window.innerHeight,
        scrollHeight: document.body.scrollHeight,
      }
    })
    await page.waitForTimeout(SCROLL_DELAY)

    var cur = await page.evaluate(function() {
      return document.querySelectorAll('h2 a[href]').length
    })

    var atBottom = (info.scrollY + info.innerHeight + 50) >= info.scrollHeight
    console.log('[time2padel]   ' + label + 'scroll ' + (i + 1) + ': ' + cur + ' productos' + (atBottom ? ' [fin]' : ''))

    if (cur !== prev) {
      sinCambio = 0
      prev = cur
      // Si cargaron nuevos productos, hacer scroll a bottom para forzar
      // que el siguiente chunk ya esté al fondo correcto
    } else if (atBottom) {
      sinCambio++
      if (sinCambio >= 3) {
        console.log('[time2padel]   ' + label + 'fin de scroll — ' + cur + ' productos cargados')
        break
      }
    }
    // Si no hay cambio pero no estamos al fondo, seguir scrolleando
  }
  return prev
}

async function extractProducts(page) {
  return page.evaluate(function() {
    var items = []
    var seen  = new Set()

    // Estrategia PRIMARIA: DOM-walker desde h2 a[href]
    // En time2padel, article.product-miniature SOLO contiene la imagen.
    // El título y el precio son hermanos del article (fuera de él).
    var articles = []
    var h2Links = Array.from(document.querySelectorAll('h2 a[href]'))
      .filter(function(a) {
        return a.href
          && a.href.indexOf('#') === -1
          && a.href.indexOf('time2padel.com') !== -1
          && a.textContent && a.textContent.trim().length > 3
      })
    var seen2 = new Set()
    for (var k = 0; k < h2Links.length; k++) {
      var a = h2Links[k]
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
      if (!container) {
        container = a.closest('li, article, div[class]') || (a.parentElement && a.parentElement.parentElement)
      }
      if (container && !seen2.has(container)) {
        seen2.add(container)
        articles.push(container)
      }
    }

    // Fallback: contenedores estándar PrestaShop
    if (articles.length === 0) {
      articles = Array.from(document.querySelectorAll(
        'article.product-miniature, .product-miniature, .js-product-miniature, li[class*="product-miniature"], div[class*="product-miniature"]'
      ))
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
  console.log('[time2padel] Iniciando scraper (Playwright — scroll infinito)...')

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
    // ── Cargar categoría principal ────────────────────────────────────────────
    console.log('[time2padel]   Cargando categoría...')
    await page.goto(CATEGORY_URL, { waitUntil: 'load', timeout: 45000 })
    await page.waitForTimeout(4000)

    // Cerrar banner cookies
    try {
      await page.waitForSelector(
        '.cmplz-accept, [data-cky-tag="accept-button"], #onetrust-accept-btn-handler, .js-btn-accept-all, .cc-btn, #didomi-notice-agree-button',
        { timeout: 5000 }
      )
      await page.click('.cmplz-accept, [data-cky-tag="accept-button"], #onetrust-accept-btn-handler, .js-btn-accept-all, .cc-btn, #didomi-notice-agree-button')
      await page.waitForTimeout(1000)
    } catch(e) { /* sin banner */ }

    // CF check
    if (await esCloudflarePage(page)) {
      console.log('[time2padel]   Cloudflare — abortando')
      await context.close(); await browser.close()
      return []
    }

    // Código descuento
    const bodyText = await page.evaluate(function() { return document.body.innerText })
    codigoDescuento = detectarCodigoDescuento(bodyText)
    if (codigoDescuento) {
      console.log('[time2padel] codigo: ' + codigoDescuento.codigo + ' (-' + codigoDescuento.descuento_pct + '%)')
    }

    // Secciones rebajas (detectar antes del scroll, los links ya están en el DOM)
    const hrefs = await page.evaluate(function() {
      return Array.from(document.querySelectorAll('a[href]')).map(function(a) { return a.href })
    })
    rebajasUrls = filtrarUrlsRebajas(hrefs, CATEGORY_URL).filter(function(u) {
      return !/paletero/i.test(u) && /palas|outlet.*pad|pad.*outlet/i.test(u)
    })

    // Esperar primeros productos
    try {
      await page.waitForFunction(function() {
        return document.querySelectorAll('article.product-miniature, .product-miniature, .js-product-miniature').length > 0
          || document.querySelectorAll('h2 a[href]').length >= 5
      }, { timeout: 20000 })
    } catch(e) {
      console.log('[time2padel]   Sin productos — abortando')
      await context.close(); await browser.close()
      return []
    }

    // ── Scroll hasta cargar todo el catálogo ─────────────────────────────────
    await scrollHastaCargarTodo(page, '')

    // Debug final
    const dbgFinal = await page.evaluate(function() {
      return {
        h2links:   document.querySelectorAll('h2 a[href]').length,
        priceCount: document.querySelectorAll('.product-price, [itemprop="price"]').length,
        miniature:  document.querySelectorAll('article.product-miniature, .product-miniature').length,
      }
    })
    console.log('[time2padel]   debug final:', JSON.stringify(dbgFinal))

    const products = await extractProducts(page)
    for (var i = 0; i < products.length; i++) {
      var p = products[i]
      if (!isPala(p.title) || seen.has(p.url)) continue
      seen.add(p.url)
      allProducts.push(p)
    }
    console.log('[time2padel]   Categoría -> ' + allProducts.length + ' palas')

    // ── Secciones rebajas — fetch() desde sesión CF ya establecida ──────────
    // goto() a rebajas es bloqueado por CF desde IPs de GHA.
    // fetch() desde dentro de la página lleva las cookies CF válidas y pasa.
    // Se itera ?page=N hasta que no haya más productos.
    for (var ri = 0; ri < rebajasUrls.length; ri++) {
      var rUrl = rebajasUrls[ri]
      console.log('[time2padel]   Rebajas fetch: ' + rUrl)
      var rpageNum = 1
      while (rpageNum <= 30) {
        var fetchUrl = rpageNum === 1 ? rUrl : rUrl + '?page=' + rpageNum
        var rResult = await page.evaluate(async function({ url, baseUrl }) {
          try {
            var res = await fetch(url, {
              credentials: 'include',
              headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.9',
                'Referer': 'https://www.time2padel.com/es/5-palas-de-padel',
              }
            })
            if (!res.ok) return { error: 'HTTP ' + res.status }
            var html = await res.text()
            if (html.indexOf('Just a moment') !== -1 || html.indexOf('cf-browser-verification') !== -1) {
              return { error: 'CF' }
            }
            var doc = new DOMParser().parseFromString(html, 'text/html')
            var items = []
            var seen = new Set()
            var h2Links = Array.from(doc.querySelectorAll('h2 a[href]'))
              .filter(function(a) {
                var href = a.getAttribute('href') || ''
                return href && href.indexOf('#') === -1
                  && a.textContent && a.textContent.trim().length > 3
              })
            var seen2 = new Set()
            var articles = []
            for (var k = 0; k < h2Links.length; k++) {
              var a = h2Links[k]
              var container = null
              var el = a.parentElement
              for (var depth = 0; depth < 10; depth++) {
                if (!el || el.tagName === 'BODY') break
                if (el.querySelector('span.product-price, .product-price, [itemprop="price"]')) {
                  container = el; break
                }
                el = el.parentElement
              }
              if (!container) container = a.closest('li, article, div[class]') || (a.parentElement && a.parentElement.parentElement)
              if (container && !seen2.has(container)) { seen2.add(container); articles.push(container) }
            }
            for (var i = 0; i < articles.length; i++) {
              var art = articles[i]
              var linkEl = art.querySelector('.product-title a, h2 a, h3 a, .product-name a')
              if (!linkEl) continue
              var href2 = linkEl.getAttribute('href') || ''
              var url2 = href2.startsWith('http') ? href2 : (baseUrl + href2)
              var title = (linkEl.textContent || '').trim()
              if (!url2 || !title || seen.has(url2)) continue
              seen.add(url2)
              var priceEl = art.querySelector('span.product-price, .price')
              var priceContent = priceEl && priceEl.getAttribute('content')
              var price = priceContent ? parseFloat(priceContent) : NaN
              if (isNaN(price) || price <= 0) {
                var txt = priceEl ? priceEl.textContent.replace(/[^0-9,]/g, '').replace(',', '.') : ''
                price = parseFloat(txt)
              }
              if (isNaN(price) || price < 30) continue
              var origEl = art.querySelector('span.regular-price, .old-price, del, s')
              var origText = origEl ? origEl.textContent.trim() : ''
              var original = origText ? parseFloat(origText.replace(/[^0-9,]/g, '').replace(',', '.')) : NaN
              var imgEl = art.querySelector('img[data-src], img')
              var rawImg = imgEl ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || '') : ''
              var image = rawImg && !rawImg.startsWith('data:') && rawImg.indexOf('blank.png') === -1 ? rawImg.split('?')[0] : null
              items.push({
                title: title, price: price,
                precio_original: (!isNaN(original) && original > price) ? original : null,
                url: url2, image: (image && image.startsWith('http')) ? image : null,
              })
            }
            // ¿Hay página siguiente?
            var hasNext = html.indexOf('page=' + (parseInt(url.split('page=')[1] || '1') + 1)) !== -1
              || html.indexOf('rel="next"') !== -1
              || (h2Links.length >= 12 && html.indexOf('rel="next"') !== -1)
            return { items: items, h2count: h2Links.length, hasNext: hasNext }
          } catch(e) { return { error: e.message } }
        }, { url: fetchUrl, baseUrl: BASE_URL })

        if (rResult.error) {
          console.log('[time2padel]   Rebajas p' + rpageNum + ' — ' + rResult.error)
          break
        }
        console.log('[time2padel]   Rebajas ' + rUrl.split('/es/')[1] + ' p' + rpageNum + ': ' + rResult.h2count + ' en html')
        if (!rResult.items || rResult.items.length === 0) break

        var radd = 0
        for (var rj = 0; rj < rResult.items.length; rj++) {
          var rp = rResult.items[rj]
          if (!isPala(rp.title) || seen.has(rp.url)) continue
          seen.add(rp.url)
          allProducts.push(rp)
          radd++
        }
        console.log('[time2padel]   -> ' + radd + ' nuevas (total: ' + allProducts.length + ')')

        if (!rResult.hasNext || rResult.h2count < 12) break
        rpageNum++
        await page.waitForTimeout(1500)
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
