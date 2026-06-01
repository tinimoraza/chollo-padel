// scripts/prices/scrapers/romasport.js
// v2 (2026-05-29): paginación WooCommerce (/page/N/) en vez de scroll infinito
const SOURCE_KEY   = 'romasport'
const BASE_URL     = 'https://romasport.es/categoria-producto/padel/padel-palas/'
const DELAY_MS     = 2000

async function extractProducts(page) {
  return page.evaluate(() => {
    const items = []
    const els = Array.from(document.querySelectorAll('li.product, .type-product, article.product'))
    els.forEach(el => {
      const titleEl = el.querySelector('.woocommerce-loop-product__title, h2, h3, .product-title')
      // WooCommerce con oferta: <del>precio_original</del><ins>precio_oferta</ins>
      // querySelector devuelve el primero en DOM → podría coger el del (tachado).
      // Fix: preferir ins explícitamente; si no hay oferta, coger el último .amount.
      const allAmounts = Array.from(el.querySelectorAll('.price .amount'))
      const insEl   = el.querySelector('.price ins .amount')
      const priceEl = insEl ?? allAmounts[allAmounts.length - 1] ?? null
      const origEl  = el.querySelector('.price del .amount')
      const linkEl  = el.querySelector('a')

      const title     = titleEl?.textContent?.trim()
      const priceText = priceEl?.textContent?.replace(/[^\d,.]/g, '').replace(',', '.') ?? ''
      const origText  = origEl?.textContent?.replace(/[^\d,.]/g, '').replace(',', '.') ?? ''
      const url       = linkEl?.href ?? ''

      const price    = parseFloat(priceText)
      const original = parseFloat(origText)

      if (!title || !price || isNaN(price) || !url.startsWith('http')) return
      items.push({
        title,
        price,
        precio_original: !isNaN(original) && original > price ? original : null,
        url,
      })
    })
    return items
  })
}

async function scrape() {
  console.log('[romasport] Iniciando scraper (paginación WooCommerce)…')

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch {
    console.error('[romasport] playwright no instalado — npm install playwright')
    return []
  }

  const browser = await chromium.launch({ headless: true })
  const page    = await browser.newPage()

  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })

  const allProducts = []
  let pageNum = 1

  try {
    while (true) {
      const url = pageNum === 1 ? BASE_URL : `${BASE_URL}page/${pageNum}/`
      console.log(`[romasport] Página ${pageNum}: ${url}`)

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

      // Cerrar banner de cookies (solo en página 1)
      if (pageNum === 1) {
        try {
          await page.waitForSelector('[data-cky-tag="accept-button"], .cky-btn-accept', { timeout: 5000 })
          await page.click('[data-cky-tag="accept-button"], .cky-btn-accept')
          console.log('[romasport] Banner cookies cerrado ✅')
          await page.waitForTimeout(1000)
        } catch {
          console.log('[romasport] Sin banner de cookies')
        }
      }

      // Esperar productos
      try {
        await page.waitForSelector('li.product, .type-product, article.product', { timeout: 15000 })
      } catch {
        console.log(`[romasport] Sin productos en página ${pageNum} — fin`)
        break
      }

      const products = await extractProducts(page)
      console.log(`[romasport]  → ${products.length} productos`)

      if (products.length === 0) break
      allProducts.push(...products)

      // Comprobar si hay página siguiente
      const hasNext = await page.evaluate(() => {
        return !!document.querySelector('a.next, .next.page-numbers, a[class*="next"]')
      })

      if (!hasNext) {
        console.log(`[romasport] Última página (${pageNum}). Total: ${allProducts.length}`)
        break
      }

      pageNum++
      await page.waitForTimeout(DELAY_MS)
    }
  } catch (err) {
    console.error('[romasport] Error:', err.message)
  } finally {
    await browser.close()
  }

  const seen   = new Set()
  const unique = allProducts.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[romasport] Total palas: ${unique.length}`)

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
