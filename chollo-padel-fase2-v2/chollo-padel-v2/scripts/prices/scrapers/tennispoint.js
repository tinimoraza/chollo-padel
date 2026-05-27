// scripts/prices/scrapers/tennispoint.js
// Scraper Tennis-Point ES — Playwright + paginación estándar
// URL catálogo: https://www.tennis-point.es/padel/palas-de-padel/

const SOURCE_KEY  = 'tennispoint'
const BASE_URL    = 'https://www.tennis-point.es/padel/palas-de-padel/'
const DELAY_MS    = 1500

async function scrape() {
  console.log('[tennispoint] Iniciando scraper…')

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch {
    console.error('[tennispoint] playwright no instalado — npm install playwright')
    return []
  }

  const browser = await chromium.launch({ headless: true })
  const page    = await browser.newPage()

  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'es-ES,es;q=0.9',
  })

  const allProducts = []
  let pageNum = 1

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(2000)

    // Cerrar banner de cookies si aparece
    try {
      await page.waitForSelector('#usercentrics-root', { timeout: 4000 })
      await page.evaluate(() => {
        const shadow = document.querySelector('#usercentrics-root')?.shadowRoot
        const btn = shadow?.querySelector('button[data-testid="uc-accept-all-button"]')
        btn?.click()
      })
      await page.waitForTimeout(1000)
    } catch { /* sin banner */ }

    while (true) {
      await page.waitForSelector('.ProductListPage__products', { timeout: 20_000 })
      console.log(`[tennispoint] Extrayendo página ${pageNum}…`)

      const products = await page.evaluate(() => {
        function parsePrice(text) {
          if (!text) return NaN
          return parseFloat(text.replace(/[^0-9,]/g, '').replace(',', '.'))
        }

        const cards = Array.from(document.querySelectorAll('.ProductCardInfo'))
        return cards.map(card => {
          const title = card.querySelector('.ProductCardInfo__name')?.textContent?.trim()
          const url   = card.closest('a')?.href
          const priceEl = card.querySelector('.ProductPrice__current, .price-current')
          const price = parsePrice(priceEl?.textContent ?? '')
          const origEl = card.querySelector('.ProductPrice__original, .price-old')
          const original = parsePrice(origEl?.textContent ?? '')

          if (!title || !url || isNaN(price) || price <= 0) return null
          return {
            title,
            price,
            precio_original: (!isNaN(original) && original > price) ? original : null,
            url,
          }
        }).filter(Boolean)
      })

      console.log(`[tennispoint]  → ${products.length} palas`)
      allProducts.push(...products)

      // Siguiente página
      const nextUrl = await page.evaluate((currentPage) => {
        const next = document.querySelector('a[rel="next"], .Pagination__next:not(.disabled) a, li.next a')
        if (!next?.href) return null
        // Anti-loop: verificar que el número de página aumenta
        const match = next.href.match(/[?&]page=(\d+)/)
        if (match && parseInt(match[1]) <= currentPage) return null
        return next.href
      }, pageNum)

      if (!nextUrl) {
        console.log(`[tennispoint] Última página (${pageNum}). Total: ${allProducts.length}`)
        break
      }

      await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await page.waitForTimeout(DELAY_MS)
      pageNum++
    }
  } catch (err) {
    console.error('[tennispoint] Error:', err.message)
  } finally {
    await browser.close()
  }

  // Deduplicar por URL
  const seen = new Set()
  const unique = allProducts.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[tennispoint] Total palas únicas: ${unique.length}`)
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
