// scripts/prices/scrapers/padelproshop.js
// Scraper PadelPROShop — Playwright + Shopify
// URL catálogo: https://padelproshop.com/collections/palas-padel
//
// v2 (2026-05-27):
//   - Dominio corregido: padel-pro-shop.es → padelproshop.com
//   - URL corregida: /categoria-producto/palas/ (WooCommerce 404) → /collections/palas-padel (Shopify)
//   - Selectores actualizados: li.product → product-card[data-hover-title] (custom element Shopify)
//   - Precio actual: span.price span.money
//   - Precio tachado: span.compare-at-price span.money
//   - Paginación: /collections/palas-padel?page=N

const SOURCE_KEY   = 'padelproshop'
const BASE_URL     = 'https://padelproshop.com/collections/palas-padel'
const DELAY_MS     = 1500

function parsePrice(text) {
  if (!text) return NaN
  return parseFloat(text.replace(/[^0-9,]/g, '').replace(',', '.'))
}

async function extractProducts(page) {
  return page.evaluate(() => {
    function parsePrice(text) {
      if (!text) return NaN
      return parseFloat(text.replace(/[^0-9,]/g, '').replace(',', '.'))
    }

    const cards = Array.from(document.querySelectorAll('product-card[data-hover-title]'))
    return cards.map(card => {
      const title = card.getAttribute('data-hover-title')
      if (!title) return null

      const linkEl = card.querySelector('a.product-card__link')
      if (!linkEl) return null
      const path = linkEl.getAttribute('href') || ''
      const url = path.startsWith('http') ? path : `https://padelproshop.com${path.split('?')[0]}`

      const priceEl   = card.querySelector('span.price span.money')
      const compareEl = card.querySelector('span.compare-at-price span.money')

      const price    = priceEl   ? parseFloat(priceEl.textContent.replace(/[^0-9,]/g, '').replace(',', '.'))   : NaN
      const original = compareEl ? parseFloat(compareEl.textContent.replace(/[^0-9,]/g, '').replace(',', '.')) : NaN

      if (!title || !url || isNaN(price) || price <= 0) return null
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
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'es-ES,es;q=0.9',
  })

  const allProducts = []
  let pageNum = 1

  try {
    while (true) {
      const url = pageNum === 1 ? BASE_URL : `${BASE_URL}?page=${pageNum}`
      console.log(`[padelproshop] Página ${pageNum}: ${url}`)

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40_000 })
      await page.waitForTimeout(2000)

      // Cerrar cookies si aparece
      try {
        await page.click('button[id*="accept"], .cc-btn, [data-cky-tag="accept-button"]', { timeout: 2000 })
        await page.waitForTimeout(500)
      } catch { /* sin banner */ }

      // Esperar a que carguen las product-cards
      try {
        await page.waitForSelector('product-card[data-hover-title]', { timeout: 15_000 })
      } catch {
        console.log(`[padelproshop] Sin productos en página ${pageNum} — fin`)
        break
      }

      const products = await extractProducts(page)
      console.log(`[padelproshop]  → ${products.length} palas`)

      if (products.length === 0) break
      allProducts.push(...products)

      // Comprobar si hay página siguiente
      // Shopify usa <link rel="next"> en el <head>, no un <a> visible en el DOM
      const hasNext = await page.evaluate(() => {
        return !!document.querySelector('link[rel="next"]')
      })

      if (!hasNext) {
        console.log(`[padelproshop] Última página (${pageNum}). Total: ${allProducts.length}`)
        break
      }

      pageNum++
      await page.waitForTimeout(DELAY_MS)
    }
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
