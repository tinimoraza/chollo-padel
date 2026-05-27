// scripts/prices/scrapers/padeliberico.js
// Scraper Padel Ibérico — Playwright + WooCommerce/PrestaShop
// URL catálogo: https://www.padeliberico.es/palas-de-padel/

const SOURCE_KEY   = 'padeliberico'
const CATEGORY_URL = 'https://www.padeliberico.es/palas-de-padel/'
const DELAY_MS     = 1800

async function extractPage(page) {
  return page.evaluate(() => {
    function parsePrice(text) {
      if (!text) return NaN
      const cleaned = text.replace(/[^\d,.\s]/g, '').trim()
      // Formato español: 1.234,56 o 234,56
      const m = cleaned.match(/([\d.]*\d)[\s,](\d{2})/)
      if (m) return parseFloat(`${m[1].replace('.', '')}.${m[2]}`)
      // Fallback
      const n = parseFloat(cleaned.replace(',', '.'))
      return isNaN(n) ? NaN : n
    }

    // WooCommerce standard
    const wooProducts = Array.from(document.querySelectorAll('li.product, .product-item'))
    if (wooProducts.length > 0) {
      return wooProducts.map(el => {
        const titleEl = el.querySelector('.woocommerce-loop-product__title, .product-title, h2, h3')
        const title   = titleEl?.textContent?.trim()
        const linkEl  = el.querySelector('a.woocommerce-loop-product__link, a')
        const url     = linkEl?.href
        if (!title || !url || !url.startsWith('http')) return null

        const currentEl  = el.querySelector('.price ins .woocommerce-Price-amount bdi, .price .woocommerce-Price-amount bdi')
        const originalEl = el.querySelector('.price del .woocommerce-Price-amount bdi')
        const price      = parsePrice(currentEl?.textContent ?? el.querySelector('.woocommerce-Price-amount bdi')?.textContent ?? '')
        const original   = parsePrice(originalEl?.textContent ?? '')

        if (isNaN(price) || price <= 0) return null
        return {
          title,
          price,
          precio_original: (!isNaN(original) && original > price) ? original : null,
          url,
        }
      }).filter(Boolean)
    }

    // PrestaShop fallback
    const psProducts = Array.from(document.querySelectorAll('.product-miniature, article.product-miniature'))
    return psProducts.map(el => {
      const titleEl = el.querySelector('.product-title a, h3 a, h2 a')
      const title   = titleEl?.textContent?.trim()
      const url     = titleEl?.href ?? el.querySelector('a')?.href
      if (!title || !url) return null

      const priceEl = el.querySelector('.price, .product-price-and-shipping .price')
      const price   = parsePrice(priceEl?.textContent ?? '')
      if (isNaN(price) || price <= 0) return null

      return { title, price, precio_original: null, url }
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

      // Cerrar cookies
      try {
        await page.click('.cmplz-accept, [data-cky-tag="accept-button"], button[id*="accept"], .cc-btn', { timeout: 3000 })
        await page.waitForTimeout(800)
      } catch {}

      console.log(`[padeliberico] Extrayendo página ${pageNum}…`)

      const products = await extractPage(page)
      console.log(`[padeliberico]  → ${products.length} palas`)
      allProducts.push(...products)

      // Siguiente página — WooCommerce o PrestaShop
      currentUrl = await page.evaluate(() => {
        const next = document.querySelector(
          'a.next.page-numbers, ' +
          'a[rel="next"], ' +
          '.pagination .next a, ' +
          'li.next a'
        )
        return next?.href ?? null
      })

      pageNum++
      if (currentUrl) await page.waitForTimeout(DELAY_MS)
    }

    console.log(`[padeliberico] Última página (${pageNum - 1}). Total: ${allProducts.length}`)
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
