// scripts/prices/scrapers/padelcoronado.js
const SOURCE_KEY   = 'padelcoronado'
const SHOP_URL     = 'https://padelcoronado.com/tienda/'
const SCROLL_PAUSE_MS = 3000
const MAX_SCROLLS     = 150
const STABLE_NEEDED   = 4

const EXCLUIR = ['zapatilla','mochila','paletero','bolsa','grip','overgrip',
  'pelota','camiseta','short','polo','funda','muñequera','visera',
  'gorra','calcetín','calcetines','protector','cordaje','raqueta','señora accesorio']

function isBlade(title) {
  const t = title.toLowerCase()
  if (EXCLUIR.some(w => t.includes(w))) return false
  // Debe contener "pala" o ser claramente una pala (marca conocida + modelo)
  return t.includes('pala') || t.includes('padel')
}

async function scrape() {
  console.log('[padelcoronado] Iniciando scraper (Playwright)…')

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

  console.log(`[padelcoronado] Abriendo ${SHOP_URL}`)
  await page.goto(SHOP_URL, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(3000)

  // Cerrar banner de cookies si aparece
  try {
    await page.waitForSelector('[data-cky-tag="accept-button"], .cky-btn-accept, #cookie-law-info-bar, button[class*="cookie"], .cc-btn', { timeout: 5000 })
    await page.click('[data-cky-tag="accept-button"], .cky-btn-accept, #cookie-law-info-bar, button[class*="cookie"], .cc-btn')
    console.log('[padelcoronado] Banner cookies cerrado ✅')
    await page.waitForTimeout(1500)
  } catch {
    console.log('[padelcoronado] Sin banner de cookies')
  }

  // Scroll hasta estabilización
  let prevCount   = 0
  let stableCount = 0
  let scrolls     = 0

  while (scrolls < MAX_SCROLLS) {
    const count = await page.evaluate(() =>
      document.querySelectorAll('li.product, .type-product').length
    )

    console.log(`[padelcoronado]   scroll ${scrolls + 1}: ${count} productos visibles`)

    if (count === prevCount) {
      stableCount++
      if (stableCount >= STABLE_NEEDED) {
        console.log(`[padelcoronado] ${STABLE_NEEDED} scrolls sin cambio — fin`)
        break
      }
    } else {
      stableCount = 0
    }

    prevCount = count

    // Click en "siguiente página" si existe, si no scroll
    const nextBtn = await page.$('a.next.page-numbers, .woocommerce-pagination a.next')
    if (nextBtn) {
      await nextBtn.click()
      await page.waitForTimeout(SCROLL_PAUSE_MS)
      await page.waitForSelector('li.product, .type-product', { timeout: 10000 }).catch(() => {})
    } else {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(SCROLL_PAUSE_MS)
    }

    scrolls++
  }

  // Extraer productos
  const products = await page.evaluate(() => {
    const items = []
    const els = Array.from(document.querySelectorAll('li.product, .type-product'))

    els.forEach(el => {
      const titleEl = el.querySelector('.woocommerce-loop-product__title, h2, h3')
      const priceEl = el.querySelector('.price ins .amount, .price .woocommerce-Price-amount, .woocommerce-Price-amount')
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

  // Filtrar solo palas
  const palas = products.filter(p => isBlade(p.title))

  const seen   = new Set()
  const unique = palas.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[padelcoronado] Total palas: ${unique.length} (de ${products.length} productos)`)

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
