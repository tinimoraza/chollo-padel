// scripts/prices/scrapers/padelproshop.js
// Scraper Padel Pro Shop — Playwright + WooCommerce
// URL catálogo: https://padel-pro-shop.es/categoria-producto/palas/

const SOURCE_KEY  = 'padelproshop'
const CATEGORY_URL = 'https://padel-pro-shop.es/categoria-producto/palas/'
const DELAY_MS    = 2000

async function extractPage(page) {
  return page.evaluate(() => {
    function parsePrice(text) {
      if (!text) return NaN
      const m = text.match(/([\d.]+,\d{2})/)
      if (!m) return NaN
      return parseFloat(m[1].replace('.', '').replace(',', '.'))
    }

    const products = Array.from(document.querySelectorAll('li.product'))
    return products.map(el => {
      const titleEl = el.querySelector('.woocommerce-loop-product__title, h2, h3')
      const title   = titleEl?.textContent?.trim()
      if (!title) return null

      const linkEl = el.querySelector('a.woocommerce-loop-product__link, a')
      const url    = linkEl?.href
      if (!url || !url.startsWith('http')) return null

      // Precio actual (con rebajas coge el del <ins>)
      const currentEl  = el.querySelector('.price ins .woocommerce-Price-amount bdi, .price .woocommerce-Price-amount bdi')
      const originalEl = el.querySelector('.price del .woocommerce-Price-amount bdi')
      const price    = parsePrice(currentEl?.textContent ?? el.querySelector('.woocommerce-Price-amount bdi')?.textContent ?? '')
      const original = parsePrice(originalEl?.textContent ?? '')

      if (isNaN(price) || price <= 0) return null
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
  console.log('[padelproshop] Iniciando scraper…')

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch {
    console.error('[padelproshop] playwright no instalado')
    return []
  }

  const browser = await chromium.launch({ headless: true })
  const page    = await browser.newPage()

  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'es-ES,es;q=0.9',
  })

  const allProducts = []
  let currentUrl = CATEGORY_URL
  let pageNum = 1

  try {
    while (currentUrl) {
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 40_000 })
      await page.waitForTimeout(1500)

      // Cerrar cookies si aparece
      try {
        await page.click('.cmplz-accept, [data-cky-tag="accept-button"], .cc-btn.cc-allow', { timeout: 3000 })
        await page.waitForTimeout(800)
      } catch { /* sin banner */ }

      await page.waitForSelector('li.product', { timeout: 15_000 })
      console.log(`[padelproshop] Extrayendo página ${pageNum}…`)

      const products = await extractPage(page)
      console.log(`[padelproshop]  → ${products.length} palas`)
      allProducts.push(...products)

      // Paginación WooCommerce estándar
      currentUrl = await page.evaluate((currentPageNum) => {
        const next = document.querySelector('a.next.page-numbers')
        if (!next?.href) return null
        return next.href
      }, pageNum)

      pageNum++
      if (currentUrl) await page.waitForTimeout(DELAY_MS)
    }

    console.log(`[padelproshop] Última página (${pageNum - 1}). Total: ${allProducts.length}`)
  } catch (err) {
    console.error('[padelproshop] Error:', err.message)
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

  console.log(`[padelproshop] Total palas únicas: ${unique.length}`)
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
