// scripts/prices/scrapers/romasport.js
// v2 (2026-05-29): paginación WooCommerce (/page/N/) en vez de scroll infinito
const SOURCE_KEY   = 'romasport'
const BASE_URL     = 'https://romasport.es/categoria-producto/padel/padel-palas/'
const DELAY_MS     = 2000

const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

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
      const imgEl   = el.querySelector('img.wp-post-image, img.attachment-woocommerce_thumbnail, img')

      const title     = titleEl?.textContent?.trim()
      const priceText = priceEl?.textContent?.replace(/[^\d,.]/g, '').replace(',', '.') ?? ''
      const origText  = origEl?.textContent?.replace(/[^\d,.]/g, '').replace(',', '.') ?? ''
      const url       = linkEl?.href ?? ''
      const image     = imgEl?.getAttribute('data-src') || imgEl?.src || null

      const price    = parseFloat(priceText)
      const original = parseFloat(origText)

      if (!title || !price || isNaN(price) || !url.startsWith('http')) return
      items.push({
        title,
        price,
        precio_original: !isNaN(original) && original > price ? original : null,
        url,
        image: image && image.startsWith('http') ? image : null,
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
  let codigoDescuento = null
  let rebajasUrls = []

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

      if (pageNum === 1) {
        const bodyText = await page.evaluate(() => document.body.innerText)
        codigoDescuento = detectarCodigoDescuento(bodyText)
        if (codigoDescuento) {
          console.log(`[romasport] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
        }
        const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href))
        rebajasUrls = filtrarUrlsRebajas(hrefs, BASE_URL)
        if (rebajasUrls.length > 0) {
          console.log(`[romasport] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
        }
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
  }

  for (const rebajasUrl of rebajasUrls) {
    try {
      await page.goto(rebajasUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForSelector('li.product, .type-product, article.product', { timeout: 15000 })
      const products = await extractProducts(page)
      console.log(`[romasport] sección rebajas ${rebajasUrl} → ${products.length} productos`)
      allProducts.push(...products)
    } catch (e) {
      console.error(`[romasport] Error sección rebajas ${rebajasUrl}:`, e.message)
    }
    await page.waitForTimeout(DELAY_MS)
  }

  await browser.close()

  const seen   = new Set()
  const unique = allProducts.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[romasport] Total palas: ${unique.length}`)

  const scraped_at = new Date().toISOString()
  const resultado = unique.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    image:           p.image ?? null,
    scraped_at,
  }))
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
