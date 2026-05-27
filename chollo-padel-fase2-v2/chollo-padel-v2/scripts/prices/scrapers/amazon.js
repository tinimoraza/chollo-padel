// scripts/prices/scrapers/amazon.js
// Scraper Amazon ES — Playwright
//
// ⚠️  NOTA IMPORTANTE: Amazon tiene sistemas anti-bot agresivos (CAPTCHA,
//     fingerprinting). Este scraper puede fallar en GitHub Actions sin una IP
//     limpia. Opciones si falla consistentemente:
//       1. Usar Bright Data / Oxylabs con proxy residencial
//       2. Usar Amazon Product Advertising API (requiere cuenta de afiliados)
//       3. Desactivar este scraper en el workflow hasta tener solución
//     En esos casos, comenta el paso correspondiente en scrape-precios.yml.

const SOURCE_KEY   = 'amazon'
const SEARCH_URL   = 'https://www.amazon.es/s?k=pala+padel&rh=n%3A2238080031&sort=price-asc-rank'
const MAX_PAGES    = 4   // Amazon muestra ~16 productos por página
const DELAY_MS     = 3000

async function scrape() {
  console.log('[amazon] Iniciando scraper (Playwright)…')

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch {
    console.error('[amazon] playwright no instalado')
    return []
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  })

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-ES',
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()

  // Ocultar webdriver
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  const allProducts = []
  let currentUrl = SEARCH_URL
  let pageNum = 1

  try {
    while (currentUrl && pageNum <= MAX_PAGES) {
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await page.waitForTimeout(2500)

      // Detectar CAPTCHA
      const isCaptcha = await page.evaluate(() =>
        document.title.toLowerCase().includes('robot') ||
        !!document.querySelector('form[action*="validateCaptcha"]')
      )
      if (isCaptcha) {
        console.warn('[amazon] ⚠️  CAPTCHA detectado — saltando Amazon')
        break
      }

      console.log(`[amazon] Extrayendo página ${pageNum}…`)

      const products = await page.evaluate(() => {
        function parsePrice(text) {
          if (!text) return NaN
          const m = text.replace(/\s/g, '').match(/[\d]+[,.][\d]{2}/)
          return m ? parseFloat(m[0].replace(',', '.')) : NaN
        }

        const cards = Array.from(document.querySelectorAll('[data-component-type="s-search-result"]'))
        return cards.map(card => {
          const titleEl = card.querySelector('h2 a span, h2 span')
          const title = titleEl?.textContent?.trim()
          if (!title) return null

          // Filtrar solo palas de pádel
          const tl = title.toLowerCase()
          if (!tl.includes('pala') && !tl.includes('padel') && !tl.includes('raqueta')) return null

          const linkEl = card.querySelector('h2 a')
          const href   = linkEl?.href
          if (!href) return null
          // URL limpia sin parámetros de tracking
          const url = href.split('?')[0].replace(/\/ref=.+$/, '')

          const wholeEl = card.querySelector('.a-price-whole')
          const fracEl  = card.querySelector('.a-price-fraction')
          let price = NaN
          if (wholeEl) {
            const whole = wholeEl.textContent.replace(/\D/g, '')
            const frac  = fracEl?.textContent?.replace(/\D/g, '') ?? '00'
            price = parseFloat(`${whole}.${frac}`)
          }
          if (isNaN(price) || price <= 0) return null

          // Precio original (tachado)
          const origEl = card.querySelector('.a-price.a-text-price .a-offscreen')
          const original = parsePrice(origEl?.textContent ?? '')

          return {
            title,
            price,
            precio_original: (!isNaN(original) && original > price) ? original : null,
            url: url.startsWith('http') ? url : `https://www.amazon.es${url}`,
          }
        }).filter(Boolean)
      })

      console.log(`[amazon]  → ${products.length} palas`)
      allProducts.push(...products)

      // Siguiente página
      currentUrl = await page.evaluate((currentPageNum) => {
        const next = document.querySelector('.s-pagination-next:not(.s-pagination-disabled)')
        return next?.href ?? null
      }, pageNum)

      pageNum++
      if (currentUrl) await page.waitForTimeout(DELAY_MS)
    }
  } catch (err) {
    console.error('[amazon] Error:', err.message)
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

  console.log(`[amazon] Total palas únicas: ${unique.length}`)
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
