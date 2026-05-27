// scripts/prices/scrapers/padeliberico.js
// Scraper Padel Ibérico — Playwright + PrestaShop
// URL catálogo: https://www.padeliberico.es/palas-de-padel
//
// v2 (2026-05-27):
//   - Dominio corregido: padeliberico.com → padeliberico.es
//   - URL corregida: /palas-de-padel/ (404) → /palas-de-padel (sin trailing slash)
//   - Selectores actualizados para PrestaShop:
//     · Contenedor: article.product-miniature
//     · Título + URL: a.thumbnail.product-thumbnail[title][href]
//     · Precio actual: span[itemprop="price"][content]  (valor numérico en atributo content)
//     · Precio original: span.regular-price (tachado, solo cuando hay descuento)
//   - Paginación: ?page=N (332 productos, ~17 páginas)

const SOURCE_KEY   = 'padeliberico'
const BASE_URL     = 'https://www.padeliberico.es/palas-de-padel'
const DELAY_MS     = 1500

async function extractProducts(page) {
  return page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('article.product-miniature'))
    return articles.map(article => {
      // Título y URL
      const linkEl = article.querySelector('a.thumbnail.product-thumbnail')
      const title  = linkEl?.getAttribute('title')?.trim()
      const url    = linkEl?.href
      if (!title || !url) return null

      // Precio actual — PrestaShop lo pone en el atributo content (valor limpio sin símbolo)
      const priceEl = article.querySelector('span[itemprop="price"]')
      const price   = priceEl ? parseFloat(priceEl.getAttribute('content')) : NaN
      if (isNaN(price) || price <= 0) return null

      // Precio original tachado (solo existe cuando hay descuento)
      const regularEl = article.querySelector('span.regular-price')
      const originalText = regularEl?.textContent?.trim() ?? ''
      const original = originalText
        ? parseFloat(originalText.replace(/[^0-9,]/g, '').replace(',', '.'))
        : NaN

      return {
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url,
      }
    }).filter(Boolean)
  })
}

async function scrape() {
  console.log('[padeliberico] Iniciando scraper…')

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch {
    console.error('[padeliberico] playwright no instalado')
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
      const url = pageNum === 1 ? BASE_URL : `${BASE_URL}?page=${pageNum}`
      console.log(`[padeliberico] Página ${pageNum}…`)

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40_000 })
      await page.waitForTimeout(1500)

      // Cerrar cookies si aparece
      try {
        await page.click('.cmplz-accept, [data-cky-tag="accept-button"], #onetrust-accept-btn-handler', { timeout: 2000 })
        await page.waitForTimeout(500)
      } catch { /* sin banner */ }

      try {
        await page.waitForSelector('article.product-miniature', { timeout: 15_000 })
      } catch {
        console.log(`[padeliberico] Sin productos en página ${pageNum} — fin`)
        break
      }

      const products = await extractProducts(page)
      console.log(`[padeliberico]  → ${products.length} palas`)

      if (products.length === 0) break
      allProducts.push(...products)

      // Comprobar si hay página siguiente
      const hasNext = await page.evaluate((currentPage) => {
        return !!document.querySelector(`a[href*="page=${currentPage + 1}"]`)
      }, pageNum)

      if (!hasNext) {
        console.log(`[padeliberico] Última página (${pageNum}). Total: ${allProducts.length}`)
        break
      }

      pageNum++
      await page.waitForTimeout(DELAY_MS)
    }
  } catch (err) {
    console.error('[padeliberico] Error:', err.message)
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

  console.log(`[padeliberico] Total palas únicas: ${unique.length}`)
  const scraped_at = new Date().toISOString()
  return unique.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    scraped_at,
  }))
}

module.exports = { scrape, SOURCE_KEY }
