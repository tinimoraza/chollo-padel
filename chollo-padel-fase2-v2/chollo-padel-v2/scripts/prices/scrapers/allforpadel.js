// scripts/prices/scrapers/allforpadel.js
// AllForPadel — tienda oficial Adidas Pádel en España
// Plataforma: PrestaShop (URLs /es/54-palas-padel, /modules/ en assets)
// URL categoría: https://allforpadel.com/es/54-palas-padel
// Paginación: ?p=N
// Nota: PVP oficial Adidas — útil como precio de referencia techo

const SOURCE_KEY = 'allforpadel'
const BASE_URL   = 'https://allforpadel.com/es/54-palas-padel'
const DELAY_MS   = 2000

const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

async function extractProducts(page) {
  return page.evaluate(() => {
    const items  = []
    const seen   = new Set()

    // El tema custom de allforpadel (Adidas oficial) NO usa article.product-miniature.
    // Los títulos están en <h2><a href="/es/palas-padel/...">Titulo</a></h2>.
    // Usamos ese patrón para identificar productos.
    const titleLinks = Array.from(
      document.querySelectorAll('h2 a[href*="/palas-padel/"]')
    )

    for (const link of titleLinks) {
      const url = link.href
      if (!url || seen.has(url)) continue
      seen.add(url)

      const title = link.textContent?.trim()
      if (!title) continue

      // Subir al contenedor del producto (max 8 niveles) buscando el precio
      let price = NaN
      let original = NaN
      let image = null
      let node = link.parentElement

      for (let i = 0; i < 8 && node; i++) {
        // Precio: [itemprop="price"], span con content numérico, .price, [class*=price]
        const priceEl = node.querySelector(
          '[itemprop="price"], span[content], .price:not(.old-price):not(.regular-price), [class*="current"], [class*="sale"]'
        )
        if (priceEl) {
          const content = priceEl.getAttribute('content') || priceEl.getAttribute('data-price')
          if (content) {
            const v = parseFloat(content)
            if (!isNaN(v) && v > 0) { price = v; break }
          }
          const txt = priceEl.textContent.replace(/[^0-9,]/g, '').replace(',', '.')
          const v = parseFloat(txt)
          if (!isNaN(v) && v > 0) { price = v; break }
        }
        node = node.parentElement
      }

      // Si no encontramos precio por selector, extraer del innerText del contenedor
      if (isNaN(price) && node) {
        const m = node.innerText.match(/(\d{2,3}(?:[.,]\d{2})?)\s*€/)
        if (m) price = parseFloat(m[1].replace(',', '.'))
      }
      if (isNaN(price) || price <= 0) continue

      // Precio original (tachado): buscar .old-price, .regular-price, s, del
      if (node) {
        const origEl = node.querySelector('.old-price, .regular-price, s, del, [class*="old"], [class*="regular"]')
        if (origEl) {
          const txt = origEl.textContent.replace(/[^0-9,]/g, '').replace(',', '.')
          const v = parseFloat(txt)
          if (!isNaN(v) && v > price) original = v
        }
        // Imagen
        const imgEl = node.querySelector('img[data-src], img[src*="/p/"], img')
        const src = imgEl?.getAttribute('data-src') || imgEl?.src || null
        if (src && src.startsWith('http')) image = src
      }

      items.push({
        title,
        price,
        precio_original: !isNaN(original) ? original : null,
        url,
        image,
      })
    }

    return items
  })
}

async function scrape() {
  console.log('[allforpadel] Iniciando scraper (PrestaShop — Adidas oficial)...')

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch {
    console.error('[allforpadel] playwright no instalado — npm install playwright')
    return []
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
    ],
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'es-ES',
    extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' },
  })
  // Ocultar senales de automatizacion
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
    window.chrome = { runtime: {} }
  })
  const page = await context.newPage()

  const allProducts = []
  let pageNum = 1
  let codigoDescuento = null
  let rebajasUrls = []

  try {
    while (true) {
      const url = pageNum === 1 ? BASE_URL : `${BASE_URL}?p=${pageNum}`
      console.log(`[allforpadel] Pagina ${pageNum}: ${url}`)

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
        } catch { /* sin banner */ }
      }

      // Esperar productos — tema custom Adidas, NO usa article.product-miniature
      try {
        await page.waitForSelector(
          'h2 a[href*="/palas-padel/"]',
          { timeout: 30000 }
        )
      } catch {
        const debugInfo = await page.evaluate(() => ({
          url: window.location.href,
          bodyClass: document.body.className.substring(0, 150),
          title: document.title.substring(0, 100),
        })).catch(() => ({}))
        console.log(`[allforpadel] Sin productos en pagina ${pageNum} — fin`, debugInfo)
        break
      }

      if (pageNum === 1) {
        const bodyText = await page.evaluate(() => document.body.innerText)
        codigoDescuento = detectarCodigoDescuento(bodyText)
        if (codigoDescuento) {
          console.log(`[allforpadel] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
        }
        const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href))
        rebajasUrls = filtrarUrlsRebajas(hrefs, BASE_URL)
        if (rebajasUrls.length > 0) {
          console.log(`[allforpadel] seccion(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
        }
      }

      const products = await extractProducts(page)
      console.log(`[allforpadel]  -> ${products.length} palas`)

      if (products.length === 0) break
      allProducts.push(...products)

      // Hay pagina siguiente? PrestaShop usa ?p=N o rel="next"
      const hasNext = await page.evaluate((cur) => {
        return !!(
          document.querySelector(`a[href*="?p=${cur + 1}"]`) ||
          document.querySelector('a[rel="next"], .next, a.next')
        )
      }, pageNum)

      if (!hasNext) {
        console.log(`[allforpadel] Ultima pagina (${pageNum}). Total: ${allProducts.length}`)
        break
      }

      pageNum++
      await page.waitForTimeout(DELAY_MS)
    }
  } catch (err) {
    console.error('[allforpadel] Error:', err.message)
  }

  for (const rebajasUrl of rebajasUrls) {
    try {
      await page.goto(rebajasUrl, { waitUntil: 'load', timeout: 45000 })
      await page.waitForTimeout(2000)
      await page.waitForSelector('article.product-miniature, .product-miniature, li.ajax_block_product', { timeout: 15000 })
      const products = await extractProducts(page)
      console.log(`[allforpadel] seccion rebajas ${rebajasUrl} -> ${products.length} productos`)
      allProducts.push(...products)
    } catch (e) {
      console.error(`[allforpadel] Error seccion rebajas ${rebajasUrl}:`, e.message)
    }
    await page.waitForTimeout(DELAY_MS)
  }

  await context.close()
  await browser.close()

  // Deduplicar por URL
  const seen   = new Set()
  const unique = allProducts.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[allforpadel] Total palas unicas: ${unique.length}`)

  const scraped_at = new Date().toISOString()
  const resultado = unique.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    image:           p.image ?? null,
    scraped_at,
  }))
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
