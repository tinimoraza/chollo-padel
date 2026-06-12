// scripts/prices/scrapers/allforpadel.js
// AllForPadel — tienda oficial Adidas Pádel en España
// Plataforma: PrestaShop (URLs /es/54-palas-padel, /modules/ en assets)
// URL categoría: https://allforpadel.com/es/54-palas-padel
// Paginación: ?p=N
// Nota: PVP oficial Adidas — útil como precio de referencia techo

const SOURCE_KEY = 'allforpadel'
const BASE_URL   = 'https://allforpadel.com/es/54-palas-padel'
const DELAY_MS   = 2000

async function extractProducts(page) {
  return page.evaluate(() => {
    const items = []
    const articles = Array.from(document.querySelectorAll(
      'article.product-miniature, .product-miniature, li.ajax_block_product, .ajax_block_product'
    ))

    articles.forEach(article => {
      // Título y URL
      // .product-title a tiene el texto y la URL del producto
      // a.thumbnail es el enlace de imagen (texto vacío) → NO sirve para título
      const titleLinkEl = article.querySelector('.product-title a, h2 a, h3 a')
      const imgLinkEl   = article.querySelector('a.thumbnail.product-thumbnail')
      const title = titleLinkEl?.textContent?.trim()
      const url   = titleLinkEl?.href || imgLinkEl?.href
      if (!title || !url || !url.startsWith('http')) return

      // Precio actual — PrestaShop pone valor en atributo content
      // allforpadel usa span.product-price con atributo content="300" (sin itemprop)
      const priceEl = article.querySelector('span.product-price')
      const price   = priceEl ? parseFloat(priceEl.getAttribute('content')) : NaN

      // Fallback: texto del precio
      const priceTextEl = article.querySelector(
        '.price .price, .product-price, .price-box .price, span.price:not(.old-price)'
      )
      const priceFallback = priceTextEl
        ? parseFloat(priceTextEl.textContent.replace(/[^0-9,]/g, '').replace(',', '.'))
        : NaN

      const finalPrice = !isNaN(price) && price > 0 ? price
        : !isNaN(priceFallback) && priceFallback > 0 ? priceFallback
        : NaN
      if (isNaN(finalPrice) || finalPrice <= 0) return

      // Precio original (tachado)
      const origEl   = article.querySelector('span.regular-price, .old-price, del .price')
      const origText = origEl?.textContent?.trim() ?? ''
      const original = origText
        ? parseFloat(origText.replace(/[^0-9,]/g, '').replace(',', '.'))
        : NaN

      // Imagen
      const imgEl = article.querySelector('img[data-src], img.product-cover-img, img')
      const image = imgEl?.getAttribute('data-src') || imgEl?.src || null

      items.push({
        title,
        price: finalPrice,
        precio_original: (!isNaN(original) && original > finalPrice) ? original : null,
        url,
        image: image && image.startsWith('http') ? image : null,
      })
    })
    return items
  })
}

async function scrape() {
  console.log('[allforpadel] Iniciando scraper (PrestaShop — Adidas oficial)…')

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch {
    console.error('[allforpadel] playwright no instalado — npm install playwright')
    return []
  }

  const browser = await chromium.launch({ headless: true })
  const page    = await browser.newPage()

  await page.setExtraHTTPHeaders({
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'es-ES,es;q=0.9',
  })

  const allProducts = []
  let pageNum = 1

  try {
    while (true) {
      const url = pageNum === 1 ? BASE_URL : `${BASE_URL}?p=${pageNum}`
      console.log(`[allforpadel] Página ${pageNum}: ${url}`)

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 })
      await page.waitForTimeout(2000)

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

      // Esperar productos
      try {
        await page.waitForSelector(
          'article.product-miniature, .product-miniature, li.ajax_block_product',
          { timeout: 20000 }
        )
      } catch {
        console.log(`[allforpadel] Sin productos en página ${pageNum} — fin`)
        break
      }

      const products = await extractProducts(page)
      console.log(`[allforpadel]  → ${products.length} palas`)

      if (products.length === 0) break
      allProducts.push(...products)

      // ¿Hay página siguiente? PrestaShop usa ?p=N o rel="next"
      const hasNext = await page.evaluate((cur) => {
        return !!(
          document.querySelector(`a[href*="?p=${cur + 1}"]`) ||
          document.querySelector('a[rel="next"], .next, a.next')
        )
      }, pageNum)

      if (!hasNext) {
        console.log(`[allforpadel] Última página (${pageNum}). Total: ${allProducts.length}`)
        break
      }

      pageNum++
      await page.waitForTimeout(DELAY_MS)
    }
  } catch (err) {
    console.error('[allforpadel] Error:', err.message)
  } finally {
    await browser.close()
  }

  // Deduplicar por URL
  const seen   = new Set()
  const unique = allProducts.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[allforpadel] Total palas únicas: ${unique.length}`)

  const scraped_at = new Date().toISOString()
  return unique.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    image:           p.image ?? null,
    scraped_at,
  }))
}

module.exports = { scrape, SOURCE_KEY }
