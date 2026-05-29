// scripts/prices/scrapers/romasport.js
const SOURCE_KEY   = 'romasport'
const CATEGORY_URL = 'https://romasport.es/categoria-producto/padel/padel-palas/'
const SCROLL_PAUSE_MS = 2000
const MAX_SCROLLS     = 100
const STABLE_NEEDED   = 4   // scrolls sin cambio para considerar que llegamos al final

async function scrape() {
  console.log('[romasport] Iniciando scraper (Playwright scroll infinito)…')

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

  console.log(`[romasport] Abriendo ${CATEGORY_URL}`)
  await page.goto(CATEGORY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })

  // Cerrar banner de cookies
  try {
    await page.waitForSelector('[data-cky-tag="accept-button"], .cky-btn-accept', { timeout: 5000 })
    await page.click('[data-cky-tag="accept-button"], .cky-btn-accept')
    console.log('[romasport] Banner cookies cerrado ✅')
    await page.waitForTimeout(2000)
  } catch {
    console.log('[romasport] Sin banner de cookies')
  }

  // Esperar a que carguen productos
  try {
    await page.waitForSelector('.product, .type-product, article', { timeout: 10000 })
  } catch {
    console.log('[romasport] Timeout esperando productos')
  }

  // Scroll hasta que no aparezcan productos nuevos en STABLE_NEEDED scrolls seguidos
  let prevCount   = 0
  let stableCount = 0
  let scrolls     = 0

  while (scrolls < MAX_SCROLLS) {
    const count = await page.evaluate(() => {
      const selectors = ['li.product', '.type-product', 'article.product', '.product-item']
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel)
        if (els.length > 0) return els.length
      }
      return 0
    })

    console.log(`[romasport]   scroll ${scrolls + 1}: ${count} productos visibles`)

    if (count === prevCount) {
      stableCount++
      if (stableCount >= STABLE_NEEDED) {
        console.log(`[romasport] ${STABLE_NEEDED} scrolls sin cambio — fin de scroll`)
        break
      }
    } else {
      stableCount = 0
    }

    prevCount = count
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(SCROLL_PAUSE_MS)
    scrolls++
  }

  // Extraer productos
  const products = await page.evaluate(() => {
    const items = []
    const selectors = ['li.product', '.type-product', 'article.product', '.product-item']
    let els = []
    for (const sel of selectors) {
      els = Array.from(document.querySelectorAll(sel))
      if (els.length > 0) break
    }

    els.forEach(el => {
      const titleEl = el.querySelector('.woocommerce-loop-product__title, h2, h3, .product-title')
      const priceEl = el.querySelector('.price ins .amount, .price .amount, .woocommerce-Price-amount')
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

  await browser.close()

  const seen   = new Set()
  const unique = products.filter(p => {
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
