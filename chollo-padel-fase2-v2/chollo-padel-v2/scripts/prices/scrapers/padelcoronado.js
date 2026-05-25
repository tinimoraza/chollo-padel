// scripts/prices/scrapers/padelcoronado.js
const SOURCE_KEY   = 'padelcoronado'
const CATEGORY_URL = 'https://padelcoronado.com/categoria-producto/palas-padel/'

// Infinite scroll: cuántos scrolls consecutivos sin cambio para considerar que acabó
const STABLE_NEEDED   = 5
// Pausa entre scrolls (ms) — la tienda tarda ~6-8s en cargar el siguiente batch
const SCROLL_PAUSE_MS = 4000
// Máximo de scrolls por si acaso (evita bucle infinito)
const MAX_SCROLLS     = 60

async function scrape() {
  console.log('[padelcoronado] Iniciando scraper (Playwright, infinite scroll)…')

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

  await page.goto(CATEGORY_URL, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(3000)

  // Cerrar cookies
  try {
    await page.waitForSelector('.cmplz-accept, button[data-cmplz], .cc-btn, [data-cky-tag="accept-button"]', { timeout: 5000 })
    await page.click('.cmplz-accept, button[data-cmplz], .cc-btn, [data-cky-tag="accept-button"]')
    console.log('[padelcoronado] Banner cookies cerrado ✅')
    await page.waitForTimeout(1500)
  } catch {
    console.log('[padelcoronado] Sin banner de cookies')
  }

  // Esperar primer batch de productos
  try {
    await page.waitForSelector('.e-loop-item, li.product', { timeout: 10000 })
  } catch {
    console.log('[padelcoronado] No se encontraron productos')
    await browser.close()
    return []
  }

  // ── Infinite scroll hasta estabilizar ────────────────────────────────────
  let prevCount = 0
  let stable    = 0

  for (let s = 0; s < MAX_SCROLLS; s++) {
    const count = await page.evaluate(() =>
      document.querySelectorAll('.e-loop-item, li.product').length
    )

    if (count === prevCount) {
      stable++
      console.log(`[padelcoronado] Scroll ${s + 1}: ${count} productos (estable ${stable}/${STABLE_NEEDED})`)
      if (stable >= STABLE_NEEDED) break
    } else {
      stable = 0
      console.log(`[padelcoronado] Scroll ${s + 1}: ${count} productos (+${count - prevCount})`)
    }

    prevCount = count
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(SCROLL_PAUSE_MS)
  }

  const totalVisible = await page.evaluate(() =>
    document.querySelectorAll('.e-loop-item, li.product').length
  )
  console.log(`[padelcoronado] Scroll completo. Total visible: ${totalVisible}`)

  // ── Extraer todos los productos ──────────────────────────────────────────
  const products = await page.evaluate(() => {
    function parsePrice(text) {
      if (!text) return NaN
      const m = text.match(/([\d.]+,\d{2})/)
      if (!m) return NaN
      return parseFloat(m[1].replace('.', '').replace(',', '.'))
    }

    const items = []
    const els = Array.from(document.querySelectorAll('.e-loop-item, li.product'))

    els.forEach(el => {
      // Título
      const titleEl =
        el.querySelector('.elementor-heading-title') ||
        el.querySelector('.woocommerce-loop-product__title') ||
        el.querySelector('h2, h3')
      const title = titleEl?.textContent?.trim()
      if (!title) return

      // Link
      const linkEl =
        el.querySelector('a[href*="padelcoronado.com/producto/"]') ||
        el.querySelector('a[href*="padelcoronado.com"]') ||
        el.querySelector('a')
      const url = linkEl?.href ?? ''
      if (!url.startsWith('http')) return

      // Precios via screen-reader-text (estructura Elementor)
      let price    = NaN
      let original = NaN

      const srTexts = Array.from(el.querySelectorAll('span.screen-reader-text'))
        .map(s => s.textContent.trim())

      const currentSR  = srTexts.find(t => t.includes('precio actual'))
      const originalSR = srTexts.find(t => t.includes('precio original') || t.includes('precio era'))

      if (currentSR)  price    = parsePrice(currentSR)
      if (originalSR) original = parsePrice(originalSR)

      // Fallback: .woocommerce-Price-amount visible
      if (isNaN(price)) {
        const amountEl = el.querySelector(
          '.price ins .woocommerce-Price-amount bdi, ' +
          '.price .woocommerce-Price-amount bdi, ' +
          '.woocommerce-Price-amount bdi'
        )
        price = parsePrice(amountEl?.textContent ?? '')
      }

      if (isNaN(price) || price <= 0) return

      items.push({
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url,
      })
    })
    return items
  })

  await browser.close()

  // Deduplicar por URL
  const seen   = new Set()
  const unique = products.filter(p => {
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
