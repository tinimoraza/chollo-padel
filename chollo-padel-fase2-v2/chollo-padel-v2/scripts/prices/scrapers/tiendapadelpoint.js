// scripts/prices/scrapers/tiendapadelpoint.js
// OpenCart — Playwright (necesita cookies de sesión para paginación)
// ~850 productos totales, filtramos por título "Pala ..."

const SOURCE_KEY  = 'tiendapadelpoint'
const BASE_URL    = 'https://www.tiendapadelpoint.com/palas-de-padel'
const DELAY_MS    = 800

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function parsePrice(text) {
  if (!text) return NaN
  // Formato "39.95 €" (punto decimal) o "1.299,95 €" (punto miles, coma decimal)
  const clean = text.trim()
  // Si hay coma: es el decimal (formato ES con miles con punto)
  if (clean.includes(',')) {
    return parseFloat(clean.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''))
  }
  // Si solo tiene punto: es decimal directo
  return parseFloat(clean.replace(/[^\d.]/g, ''))
}

function extractProductsFromPage(page) {
  return page.evaluate(() => {
    function parsePrice(text) {
      if (!text) return NaN
      const clean = text.trim()
      if (clean.includes(',')) {
        return parseFloat(clean.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''))
      }
      return parseFloat(clean.replace(/[^\d.]/g, ''))
    }

    const items = []
    const blocks = document.querySelectorAll('.product-details')
    for (const pd of blocks) {
      const a = pd.querySelector('a')
      const title = a?.textContent?.trim()
      const url   = a?.href
      if (!title || !url) continue
      if (!title.toLowerCase().startsWith('pala ')) continue
      if (title.toLowerCase().includes('pickleball')) continue

      const priceNew = pd.querySelector('.price-new')?.textContent
      const priceOld = pd.querySelector('.price-old')?.textContent
      // Fallback: .price contiene ambos "70.00 €  39.95 €" — coger el menor
      let price = NaN, original = NaN

      if (priceNew) {
        price    = parsePrice(priceNew)
        original = priceOld ? parsePrice(priceOld) : NaN
      } else {
        const priceEl = pd.querySelector('.price')
        if (priceEl) {
          const matches = [...priceEl.textContent.matchAll(/([\d.,]+)\s*€/g)]
            .map(m => parsePrice(m[0]))
            .filter(n => !isNaN(n) && n > 0)
          if (matches.length >= 2) { price = Math.min(...matches); original = Math.max(...matches) }
          else if (matches.length === 1) price = matches[0]
        }
      }

      if (isNaN(price) || price < 30) continue

      // tiendapadelpoint es inconsistente: algunos productos en el listing
      // muestran precio SIN IVA y otros CON IVA según configuración OpenCart.
      // Heurística: si price × 1.21 da un número "de retail" (decimal .90-.99 o .00-.05),
      // el listing muestra sin IVA → aplicar IVA. Si no, ya incluye IVA.
      function aplicarIVAsiNecesario(p) {
        if (isNaN(p) || p <= 0) return p
        const conIVA = Math.round(p * 1.21 * 100) / 100
        const cents = Math.round((conIVA % 1) * 100)
        const esRetail = cents >= 90 || cents <= 5 || cents === 50
        return esRetail ? conIVA : p
      }

      const finalPrice    = aplicarIVAsiNecesario(price)
      const finalOriginal = (!isNaN(original) && original > price)
        ? aplicarIVAsiNecesario(original)
        : NaN

      items.push({
        title,
        price:           finalPrice,
        precio_original: !isNaN(finalOriginal) ? finalOriginal : null,
        url,
      })
    }
    return items
  })
}

async function scrape() {
  console.log('[tiendapadelpoint] Iniciando scraper (Playwright)…')

  let chromium
  try { ({ chromium } = require('playwright')) }
  catch { console.error('[tiendapadelpoint] playwright no instalado'); return [] }

  const browser = await chromium.launch({ headless: true })
  const page    = await browser.newPage()
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })

  const allProducts = []
  const seen = new Set()
  let pageNum = 1

  // Primera carga para establecer sesión y conocer total de páginas
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2000)

  // Cerrar cookies si aparece
  try {
    await page.waitForSelector('[class*="cookie"] button, .cc-btn, .accept-btn', { timeout: 4000 })
    await page.click('[class*="cookie"] button, .cc-btn, .accept-btn')
    await page.waitForTimeout(1000)
  } catch {}

  // Detectar total de páginas
  const totalPages = await page.evaluate(() => {
    const pag = document.querySelector('.pagination')?.textContent || ''
    const m = pag.match(/\((\d+)\s*P.ginas?\)/)
    return m ? parseInt(m[1]) : 36
  })
  console.log(`[tiendapadelpoint] Total páginas: ${totalPages}`)

  while (pageNum <= totalPages) {
    if (pageNum > 1) {
      await page.goto(`${BASE_URL}?page=${pageNum}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(1500)
    }

    const products = await extractProductsFromPage(page)
    console.log(`[tiendapadelpoint] Página ${pageNum}/${totalPages} → ${products.length} palas`)

    let newInPage = 0
    for (const p of products) {
      if (seen.has(p.url)) continue
      seen.add(p.url)
      allProducts.push(p)
      newInPage++
    }

    // Si llevamos 3 páginas sin productos nuevos, paramos
    if (newInPage === 0 && pageNum > 3) break

    pageNum++
    await sleep(DELAY_MS)
  }

  await browser.close()

  console.log(`[tiendapadelpoint] Total palas únicas: ${allProducts.length}`)
  const scraped_at = new Date().toISOString()
  return allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    scraped_at,
  }))
}

module.exports = { scrape, SOURCE_KEY }
