// scripts/prices/scrapers/padelcoronado.js
const SOURCE_KEY      = 'padelcoronado'
const CATEGORY_URL    = 'https://padelcoronado.com/categoria-producto/palas-padel/'
const SCROLL_PAUSE_MS = 4000
const MAX_SCROLLS     = 100
const STABLE_NEEDED   = 4

async function scrapeBrandPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 }).catch(() => {})
  await page.waitForTimeout(2500)

  try {
    await page.waitForSelector('.e-loop-item.product, li.product', { timeout: 8000 })
  } catch {
    console.log(`[padelcoronado]   Sin productos en ${url}`)
    return []
  }

  // Scroll hasta estabilizar
  let prevCount = 0, stableCount = 0, scrolls = 0
  while (scrolls < MAX_SCROLLS) {
    const count = await page.evaluate(() => {
      const selectors = ['.e-loop-item.product', 'li.product', '.type-product']
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel)
        if (els.length > 0) return els.length
      }
      return 0
    })
    if (count === prevCount) {
      stableCount++
      if (stableCount >= STABLE_NEEDED) break
    } else {
      stableCount = 0
    }
    prevCount = count
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(SCROLL_PAUSE_MS)
    scrolls++
  }

  return page.evaluate(() => {
    function parsePrice(text) {
      if (!text) return NaN
      const m = text.match(/([\d.]+,\d{2})/)
      if (!m) return NaN
      return parseFloat(m[1].replace('.', '').replace(',', '.'))
    }

    const selectors = ['.e-loop-item.product', 'li.product', '.type-product']
    let els = []
    for (const sel of selectors) {
      els = Array.from(document.querySelectorAll(sel))
      if (els.length > 0) break
    }

    return els.map(el => {
      const titleEl =
        el.querySelector('.elementor-heading-title') ||
        el.querySelector('.woocommerce-loop-product__title') ||
        el.querySelector('h2, h3')
      const title = titleEl?.textContent?.trim()
      if (!title) return null

      const linkEl =
        el.querySelector('a[href*="padelcoronado.com/producto/"]') ||
        el.querySelector('a[href*="padelcoronado.com"]') ||
        el.querySelector('a')
      const url = linkEl?.href ?? ''
      if (!url.startsWith('http')) return null

      let price = NaN, original = NaN
      const srTexts = Array.from(el.querySelectorAll('span.screen-reader-text'))
        .map(s => s.textContent.trim())
      const currentSR  = srTexts.find(t => t.includes('precio actual'))
      const originalSR = srTexts.find(t => t.includes('precio original') || t.includes('precio era'))
      if (currentSR)  price    = parsePrice(currentSR)
      if (originalSR) original = parsePrice(originalSR)
      if (isNaN(price)) {
        const amountEl = el.querySelector(
          '.price ins .woocommerce-Price-amount bdi, ' +
          '.price .woocommerce-Price-amount bdi, ' +
          '.woocommerce-Price-amount bdi'
        )
        price = parsePrice(amountEl?.textContent ?? '')
      }
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
  console.log('[padelcoronado] Iniciando scraper (Playwright, marcas dinámicas)…')

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch {
    console.error('[padelcoronado] playwright no instalado — npm install playwright')
    return []
  }

  const browser = await chromium.launch({ headless: true })
  const page    = await browser.newPage()

  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })

  // Cargar categoría principal para: (1) cerrar cookies, (2) descubrir marcas
  await page.goto(CATEGORY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2000)

  try {
    await page.waitForSelector('.cmplz-accept, button[data-cmplz], .cc-btn, [data-cky-tag="accept-button"]', { timeout: 5000 })
    await page.click('.cmplz-accept, button[data-cmplz], .cc-btn, [data-cky-tag="accept-button"]')
    console.log('[padelcoronado] Banner cookies cerrado ✅')
    // Esperar a que la página se estabilice tras el banner (puede hacer reload)
    await page.waitForLoadState('domcontentloaded').catch(() => {})
    await page.waitForTimeout(2500)
  } catch {
    console.log('[padelcoronado] Sin banner de cookies')
  }

  // Esperar a que el DOM esté listo antes de evaluar
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await page.waitForTimeout(1000)

  // Descubrir URLs de marca desde el sidebar de filtros
  const brandUrls = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/marca-palas-"]'))
    const urls  = links.map(a => a.href).filter(h => h.includes('/categoria-producto/palas-padel/'))
    return [...new Set(urls)]
  })

  if (brandUrls.length === 0) {
    console.log('[padelcoronado] ⚠️  No se encontraron URLs de marca — scrapeando categoría global')
    brandUrls.push(CATEGORY_URL)
  } else {
    console.log(`[padelcoronado] Marcas encontradas: ${brandUrls.length}`)
    brandUrls.forEach(u => console.log(`  • ${u}`))
  }

  // Scrapear cada marca
  const allProducts = []
  for (const brandUrl of brandUrls) {
    const brand = brandUrl.match(/marca-palas-([^/]+)/)?.[1] ?? 'global'
    console.log(`[padelcoronado] Scrapeando: ${brand}`)
    const products = await scrapeBrandPage(page, brandUrl)
    console.log(`[padelcoronado]   → ${products.length} palas`)
    allProducts.push(...products)
  }

  await browser.close()

  // Deduplicar por URL
  const seen   = new Set()
  const unique = allProducts.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[padelcoronado] Total palas únicas: ${unique.length}`)

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
