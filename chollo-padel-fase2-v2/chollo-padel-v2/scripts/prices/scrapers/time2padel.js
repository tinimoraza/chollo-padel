// scripts/prices/scrapers/time2padel.js
// Time2Padel — PrestaShop, Playwright (Cloudflare bloquea fetch/cheerio básico)
// URL: https://www.time2padel.com/es/5-palas-de-padel
// Paginación: ?page=N
//
// NOTA (fix 2026-06-18): URL cambió a /es/5-palas-de-padel (con ID).
// NOTA (fix 2026-07-16): migrado de cheerio+fetch a Playwright — HTTP 403 de Cloudflare.

const SOURCE_KEY   = 'time2padel'
const BASE_URL     = 'https://www.time2padel.com'
const CATEGORY_URL = `${BASE_URL}/es/5-palas-de-padel`
const DELAY_MS     = 2000

const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

const EXCLUIR = ['zapatilla', 'mochila', 'paletero', 'bolsa', 'grip', 'overgrip',
  'pelota', 'pelotas', 'camiseta', 'short', 'polo', 'funda', 'muñequera', 'protector',
  'cordaje', 'antivibrador', 'visera', 'gorra', 'calcetín', 'ropa', 'pack ']

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

async function extractProducts(page) {
  return page.evaluate(() => {
    const items = []
    const articles = Array.from(document.querySelectorAll(
      'article.product-miniature, .product-miniature, .js-product-miniature'
    ))

    articles.forEach(article => {
      const titleLinkEl = article.querySelector('.product-title a, h2 a, h3 a, .product-name a')
      const imgLinkEl   = article.querySelector('a.product-thumbnail, a.thumbnail')
      const title = titleLinkEl?.textContent?.trim()
      const url   = titleLinkEl?.href || imgLinkEl?.href
      if (!title || !url || !url.startsWith('http')) return

      const priceEl = article.querySelector('span.product-price, .price:not(.regular-price):not(.old-price)')
      const priceContent = priceEl?.getAttribute('content')
      let price = priceContent ? parseFloat(priceContent) : NaN
      if (isNaN(price) || price <= 0) {
        const txt = priceEl?.textContent?.replace(/[^0-9,]/g, '').replace(',', '.') || ''
        price = parseFloat(txt)
      }
      if (isNaN(price) || price < 30) return

      const origEl   = article.querySelector('span.regular-price, .old-price, del .price, s .price')
      const origText = origEl?.textContent?.trim() || ''
      const original = origText
        ? parseFloat(origText.replace(/[^0-9,]/g, '').replace(',', '.'))
        : NaN

      const imgEl = article.querySelector('img[data-src], img.product-thumbnail-first, img')
      const rawImg = imgEl?.getAttribute('data-src') || imgEl?.src || ''
      const image = rawImg && !rawImg.startsWith('data:') && !rawImg.includes('blank.png')
        ? rawImg.split('?')[0]
        : null

      items.push({
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url,
        image: (image && image.startsWith('http')) ? image : null,
      })
    })
    return items
  })
}

async function scrape() {
  console.log('[time2padel] Iniciando scraper (Playwright — PrestaShop)...')

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch {
    console.error('[time2padel] playwright no instalado')
    return []
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'es-ES',
    extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' },
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
    window.chrome = { runtime: {} }
  })
  const page = await context.newPage()

  const allProducts = []
  const seen = new Set()
  let pageNum = 1
  let codigoDescuento = null
  let rebajasUrls = []

  try {
    while (true) {
      const url = pageNum === 1 ? CATEGORY_URL : `${CATEGORY_URL}?page=${pageNum}`
      console.log(`[time2padel]   Pagina ${pageNum}: ${url}`)

      await page.goto(url, { waitUntil: 'load', timeout: 45000 })
      await page.waitForTimeout(3000)

      if (pageNum === 1) {
        try {
          await page.waitForSelector(
            '.cmplz-accept, [data-cky-tag="accept-button"], #onetrust-accept-btn-handler, .js-btn-accept-all, .cc-btn',
            { timeout: 5000 }
          )
          await page.click('.cmplz-accept, [data-cky-tag="accept-button"], #onetrust-accept-btn-handler, .js-btn-accept-all, .cc-btn')
          await page.waitForTimeout(1000)
        } catch { /* sin banner */ }
      }

      try {
        await page.waitForSelector(
          'article.product-miniature, .product-miniature, .js-product-miniature',
          { timeout: 30000 }
        )
      } catch {
        const info = await page.evaluate(() => ({
          url: window.location.href,
          status: document.title.substring(0, 80),
        })).catch(() => ({}))
        console.log(`[time2padel]   Sin productos en pag ${pageNum} — fin`, info)
        break
      }

      if (pageNum === 1) {
        const bodyText = await page.evaluate(() => document.body.innerText)
        codigoDescuento = detectarCodigoDescuento(bodyText)
        if (codigoDescuento) {
          console.log(`[time2padel] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
        }
        const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href))
        const todasRebajas = filtrarUrlsRebajas(hrefs, CATEGORY_URL)
        // Solo rebajas de palas — evitar zapatillas/ropa/paleteros que disparan mas Cloudflare
        rebajasUrls = todasRebajas.filter(u => /pala|outlet.*pad|pad.*outlet/i.test(u))
        if (rebajasUrls.length > 0) {
          console.log(`[time2padel] seccion rebajas (palas): ${rebajasUrls.join(', ')}`)
        }
      }

      const products = await extractProducts(page)
      const pageNew  = products.filter(p => isPala(p.title) && !seen.has(p.url))
      pageNew.forEach(p => seen.add(p.url))
      console.log(`[time2padel]   -> ${pageNew.length} palas en pag ${pageNum}`)
      allProducts.push(...pageNew)

      if (products.length === 0) break

      const hasNext = await page.evaluate((cur) => (
        !!(document.querySelector(`a[href*="page=${cur + 1}"]`) ||
           document.querySelector('a[rel="next"], .next a, li.next a'))
      ), pageNum)

      if (!hasNext) {
        console.log(`[time2padel] Ultima pagina (${pageNum}). Total: ${allProducts.length}`)
        break
      }

      pageNum++
      await page.waitForTimeout(DELAY_MS)
    }
  } catch (err) {
    console.error('[time2padel] Error:', err.message)
  }

  for (const rebajasUrl of rebajasUrls) {
    try {
      await page.goto(rebajasUrl, { waitUntil: 'load', timeout: 45000 })
      await page.waitForTimeout(2000)
      await page.waitForSelector(
        'article.product-miniature, .product-miniature, .js-product-miniature',
        { timeout: 15000 }
      )
      const products = await extractProducts(page)
      let added = 0
      for (const p of products) {
        if (!isPala(p.title) || seen.has(p.url)) continue
        seen.add(p.url)
        allProducts.push(p)
        added++
      }
      console.log(`[time2padel] rebajas ${rebajasUrl} -> ${added} nuevos`)
    } catch (e) {
      console.error(`[time2padel] Error rebajas ${rebajasUrl}:`, e.message)
    }
    await page.waitForTimeout(DELAY_MS)
  }

  await context.close()
  await browser.close()

  console.log(`[time2padel] Total palas: ${allProducts.length}`)
  const scraped_at = new Date().toISOString()
  const resultado = allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original || null,
    url:             p.url,
    image:           p.image || null,
    scraped_at,
  }))
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
