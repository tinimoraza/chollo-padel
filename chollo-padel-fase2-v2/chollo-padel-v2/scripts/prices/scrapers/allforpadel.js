// scripts/prices/scrapers/allforpadel.js
// AllForPadel — tienda oficial Adidas Pádel en España
// Plataforma: PrestaShop estándar (article.product-miniature, igual que otras tiendas)
// URL categoría: https://allforpadel.com/es/54-palas-padel
// Paginación: ?p=N
// Precio: .product-price[content] (entero, ej. "300")
// Nota: PVP oficial Adidas — útil como precio de referencia techo
//
// FIX 2026-07-16: el scraper anterior usaba 'h2 a[href*="/palas-padel/"]' como
// waitForSelector, que falla en headless porque los hrefs se hidratan tarde.
// La página SÍ usa article.product-miniature — usar ese selector como wait+container.

const SOURCE_KEY = 'allforpadel'
const BASE_URL   = 'https://allforpadel.com/es/54-palas-padel'
const DELAY_MS   = 2000

const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

async function extractProducts(page) {
  return page.evaluate(() => {
    const items = []
    const seen  = new Set()

    const articles = Array.from(document.querySelectorAll(
      'article.product-miniature, .product-miniature, .js-product-miniature'
    ))

    for (const art of articles) {
      const linkEl = art.querySelector('h2 a, .product-title a, h3 a, a.product-thumbnail')
      if (!linkEl) continue
      const url   = linkEl.href
      const title = linkEl.textContent?.trim()
      if (!url || !title || seen.has(url)) continue
      seen.add(url)

      // Precio: .product-price[content] = entero sin decimales (ej. "300")
      let price = NaN
      const priceContentEl = art.querySelector('.product-price[content], [itemprop="price"]')
      if (priceContentEl) {
        const c = priceContentEl.getAttribute('content')
        if (c) price = parseFloat(c)
      }
      if (isNaN(price) || price <= 0) {
        const priceTextEl = art.querySelector('.product-price, .price:not(.old-price):not(.regular-price)')
        const txt = priceTextEl?.textContent?.replace(/[^0-9,]/g, '').replace(',', '.') || ''
        price = parseFloat(txt)
      }
      if (isNaN(price) || price < 30) continue

      // Precio original (tachado)
      const origEl = art.querySelector('.regular-price, .old-price, s .price, del .price')
      let original = NaN
      if (origEl) {
        const c = origEl.getAttribute('content')
        const txt = c || origEl.textContent.replace(/[^0-9,]/g, '').replace(',', '.')
        const v = parseFloat(txt)
        if (!isNaN(v) && v > price) original = v
      }

      // Imagen: data-src lazy
      const imgEl = art.querySelector('img[data-src], img.js-lazy-product-image, img.product-thumbnail-first, img')
      const rawImg = imgEl?.getAttribute('data-src') || imgEl?.src || ''
      const image = rawImg && !rawImg.startsWith('data:') && !rawImg.includes('blank.png')
        ? rawImg.split('?')[0]
        : null

      items.push({
        title,
        price,
        precio_original: (!isNaN(original)) ? original : null,
        url,
        image: (image && image.startsWith('http')) ? image : null,
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
    ],
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'es-ES',
    extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' },
  })
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

      // Esperar productos — PrestaShop estándar article.product-miniature
      try {
        await page.waitForSelector(
          'article.product-miniature, .product-miniature, .js-product-miniature',
          { timeout: 30000 }
        )
      } catch {
        const debugInfo = await page.evaluate(() => ({
          url: window.location.href,
          bodyClass: document.body.className.substring(0, 150),
          title: document.title.substring(0, 100),
          h2count: document.querySelectorAll('h2').length,
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
          console.log(`[allforpadel] seccion(es) de rebajas: ${rebajasUrls.join(', ')}`)
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
          document.querySelector(`a[href*="p=${cur + 1}"]`) ||
          document.querySelector('a[rel="next"], .next a, li.next a')
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

  // Secciones de rebajas
  for (const rebajasUrl of rebajasUrls) {
    try {
      console.log(`[allforpadel] Rebajas: ${rebajasUrl}`)
      await page.goto(rebajasUrl, { waitUntil: 'load', timeout: 45000 })
      await page.waitForTimeout(2000)
      await page.waitForSelector(
        'article.product-miniature, .product-miniature, .js-product-miniature',
        { timeout: 15000 }
      )
      const products = await extractProducts(page)
      console.log(`[allforpadel]  -> ${products.length} productos`)
      allProducts.push(...products)
    } catch (e) {
      console.error(`[allforpadel] Error rebajas ${rebajasUrl}:`, e.message)
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
