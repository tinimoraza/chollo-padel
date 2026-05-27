// scripts/prices/scrapers/miravia.js
// Scraper Miravía ES — API JSON de búsqueda
//
// ⚠️  NOTA: Miravía (marketplace de AliExpress en España) usa una API interna
//     con autenticación dinámica. Si devuelve 401/403 frecuentemente, puede
//     necesitar rotación de User-Agent o uso de un proxy residencial.
//     En ese caso, considera Bright Data o Oxylabs para esta fuente.

const https      = require('https')
const SOURCE_KEY = 'miravia'

// Endpoint de búsqueda de Miravia
const SEARCH_URL = 'https://www.miravia.es/s?q=pala+padel&page={PAGE}&pageSize=60&sort=default'

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Referer':         'https://www.miravia.es/',
      },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpGet(res.headers.location).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch { resolve({ _raw: Buffer.concat(chunks).toString('utf8').slice(0, 200) }) }
      })
    })
    req.on('error', reject)
    req.setTimeout(20_000, () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function scrapeViaPlaywright() {
  // Fallback con Playwright si la API JSON no funciona
  console.log('[miravia] Intentando con Playwright como fallback…')
  let chromium
  try { ({ chromium } = require('playwright')) }
  catch { return [] }

  const browser = await chromium.launch({ headless: true })
  const page    = await browser.newPage()
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })

  const allProducts = []

  try {
    await page.goto('https://www.miravia.es/s?q=pala+padel&sort=default', {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })
    await page.waitForTimeout(3000)

    // Cerrar cookies
    try {
      await page.click('button[id*="accept"], button[class*="accept"]', { timeout: 3000 })
      await page.waitForTimeout(1000)
    } catch {}

    // Extraer productos de la página actual (Miravia es SPA, scroll infinito)
    let prevCount = 0, stableCount = 0
    while (stableCount < 3) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(2000)
      const count = await page.evaluate(() =>
        document.querySelectorAll('[class*="product-item"], [class*="ProductItem"]').length
      )
      stableCount = count === prevCount ? stableCount + 1 : 0
      prevCount = count
    }

    const products = await page.evaluate(() => {
      function parsePrice(text) {
        if (!text) return NaN
        const m = text.match(/[\d]+[,.]?\d*/)
        return m ? parseFloat(m[0].replace(',', '.')) : NaN
      }

      const cards = Array.from(document.querySelectorAll('[class*="product-item"], [class*="ProductItem"]'))
      return cards.map(card => {
        const title = card.querySelector('[class*="title"], [class*="name"], h3, h2')?.textContent?.trim()
        const linkEl = card.querySelector('a')
        const url = linkEl?.href
        const priceEl = card.querySelector('[class*="price-current"], [class*="PriceCurrent"], [class*="sale"]')
        const price = parsePrice(priceEl?.textContent ?? '')
        if (!title || !url || isNaN(price) || price <= 0) return null
        // Solo palas
        if (!title.toLowerCase().includes('pala') && !title.toLowerCase().includes('padel')) return null
        return { title, price, url }
      }).filter(Boolean)
    })

    allProducts.push(...products)
    console.log(`[miravia] Playwright: ${products.length} productos`)
  } catch (err) {
    console.error('[miravia] Error Playwright:', err.message)
  } finally {
    await browser.close()
  }

  return allProducts
}

async function scrape() {
  console.log('[miravia] Iniciando scraper…')

  const allProducts = []
  let page = 1
  const MAX_PAGES = 5  // Miravia suele tener pocos resultados por keyword específico

  // Intentar API JSON primero
  let apiWorking = false
  for (page = 1; page <= MAX_PAGES; page++) {
    const url = SEARCH_URL.replace('{PAGE}', page)
    console.log(`[miravia] API página ${page}…`)

    let data
    try {
      data = await httpGet(url)
    } catch (err) {
      console.log(`[miravia] API no disponible (${err.message}) → fallback Playwright`)
      break
    }

    if (data._raw) {
      // Respuesta HTML, no JSON → API no pública
      console.log('[miravia] API devuelve HTML → fallback Playwright')
      break
    }

    // Parsear respuesta JSON de Miravia
    const items = data?.data?.items ?? data?.result?.items ?? data?.items ?? []
    if (!items.length && page === 1) {
      console.log('[miravia] Sin items en API → fallback Playwright')
      break
    }

    apiWorking = true
    for (const item of items) {
      const title = item.name ?? item.title ?? ''
      if (!title.toLowerCase().includes('pala') && !title.toLowerCase().includes('padel')) continue
      const price = parseFloat(item.price ?? item.salePrice ?? 0)
      if (!price || isNaN(price)) continue
      const original = parseFloat(item.originalPrice ?? item.retailPrice ?? 0)
      const url = item.url ?? item.productUrl ?? `https://www.miravia.es/products/${item.itemId}`

      allProducts.push({
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url,
      })
    }

    const hasMore = data?.data?.hasMore ?? data?.result?.hasMore ?? items.length === 60
    if (!hasMore) break
    await sleep(1000)
  }

  // Si la API no funcionó, usar Playwright
  if (!apiWorking) {
    const fallback = await scrapeViaPlaywright()
    allProducts.push(...fallback)
  }

  // Deduplicar por URL
  const seen   = new Set()
  const unique = allProducts.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[miravia] Total palas únicas: ${unique.length}`)
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
