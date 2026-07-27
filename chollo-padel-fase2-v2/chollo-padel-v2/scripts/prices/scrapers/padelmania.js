// scripts/prices/scrapers/padelmania.js
// Padelmania - PrestaShop con protección anti-bot → Playwright
// URL catalogo: https://padelmania.com/es/338-todas-las-palas-de-padel (todas las palas)
// Paginacion: ?page=N
//
// Fix 2026-07-26: reescrito con Playwright (la URL daba HTTP 403 con fetch plain).

const SOURCE_KEY    = 'padelmania'
const BASE_URL      = 'https://padelmania.com'
const CATEGORY_PATH = '/es/338-todas-las-palas-de-padel'
const DELAY_MS      = 1500

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'munequera', 'camiseta', 'zapatilla', 'pack ']

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

async function extractProducts(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('article.product-miniature, .js-product-miniature'))
    return cards.map(card => {
      const linkEl = card.querySelector('h3.product-title a, h2.product-title a, .product-title a')
      const title  = linkEl?.textContent?.trim()
      const url    = linkEl?.href
      if (!title || !url) return null

      // Precio: atributo content es más fiable que el texto formateado
      const priceEl = card.querySelector('span[itemprop="price"][content], span.product-price[content]')
      const price   = priceEl
        ? parseFloat(priceEl.getAttribute('content'))
        : (() => {
            const t = (card.querySelector('span.product-price')?.textContent ?? '').replace(/[^\d,]/g, '').replace(',', '.')
            return parseFloat(t) || NaN
          })()
      if (isNaN(price) || price < 30) return null

      const regularEl = card.querySelector('.regular-price')
      const origText  = regularEl?.textContent?.trim() ?? ''
      const original  = origText
        ? parseFloat(origText.replace(/[^0-9,]/g, '').replace(',', '.'))
        : NaN

      const imgEl  = card.querySelector('img')
      const rawImg = imgEl ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || '') : ''
      const image  = rawImg.startsWith('data:') ? null : (rawImg.split('?')[0] || null)

      return { title, price, original, url, image }
    }).filter(Boolean)
  })
}

async function scrape() {
  console.log('[padelmania] Iniciando scraper (Playwright — anti-bot activo)…')

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch {
    console.error('[padelmania] playwright no instalado')
    return []
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-ES',
    extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' },
  })
  const page = await context.newPage()

  const allProducts = []
  const seen = new Set()
  let pageNum = 1
  let lastPage = 1
  let codigoDescuento = null
  let rebajasUrls = []

  try {
    // ── Página 1: carga inicial ─────────────────────────────────────────────
    const url1 = `${BASE_URL}${CATEGORY_PATH}?resultsPerPage=36`
    console.log(`[padelmania] Página 1: ${url1}`)
    await page.goto(url1, { waitUntil: 'domcontentloaded', timeout: 40_000 })
    await page.waitForTimeout(2000)

    // Cerrar cookie banner si aparece
    try {
      await page.click('.cmplz-accept, #cookieMsg a.close, .cookies-accept, [data-cky-tag="accept-button"]', { timeout: 2000 })
      await page.waitForTimeout(500)
    } catch { /* sin banner */ }

    // Verificar que hay productos en página 1
    try {
      await page.waitForSelector('article.product-miniature, .js-product-miniature', { timeout: 12_000 })
    } catch {
      console.error('[padelmania] Sin productos en página 1 — posible bloqueo anti-bot')
      await browser.close()
      return []
    }

    // Metadatos de página 1: código descuento, URLs rebajas, total páginas
    {
      const bodyText = await page.evaluate(() => document.body.innerText)
      codigoDescuento = detectarCodigoDescuento(bodyText)
      if (codigoDescuento) {
        console.log(`[padelmania] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
      }
      const hrefs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]')).map(a => a.href)
      )
      // Filtrar productos individuales PrestaShop (/ID-slug.html) — no son categorías
      rebajasUrls = filtrarUrlsRebajas(hrefs, `${BASE_URL}${CATEGORY_PATH}`)
        .filter(u => !/\/\d{3,}-[a-z].*\.html$/i.test(new URL(u).pathname))
      if (rebajasUrls.length > 0) {
        console.log(`[padelmania] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
      }
      // Total páginas: leer desde links de paginación del DOM
      const paginaLinks = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.pagination a')).map(a => a.href)
      )
      for (const href of paginaLinks) {
        const m = href.match(/[?&]p(?:age)?=(\d+)/)
        if (m) {
          const n = parseInt(m[1])
          if (!isNaN(n) && n > lastPage) lastPage = n
        }
      }
    }

    // Procesar productos de página 1
    const addProducts = (products) => {
      for (const p of products) {
        if (!isPala(p.title) || seen.has(p.url)) continue
        seen.add(p.url)
        const original = p.original ?? NaN
        allProducts.push({
          title:           p.title,
          price:           p.price,
          precio_original: (!isNaN(original) && original > p.price) ? original : null,
          url:             p.url,
          image:           p.image,
        })
      }
    }

    let products1 = await extractProducts(page)
    console.log(`[padelmania]  → ${products1.length} productos en página 1/${lastPage}`)
    addProducts(products1)

    // ── Páginas 2..N: click en el botón "siguiente" (paginación AJAX) ──────
    // padelmania carga la siguiente página vía AJAX cuando se hace click en el
    // botón "siguiente" — navegar directamente con goto() devuelve la página
    // sin productos. Simular el click es la única forma que funciona.
    const NEXT_SEL = 'a[rel="next"], .pagination .next a, ul.pagination li.next a, #js-product-list-bottom a[rel="next"]'

    while (pageNum < lastPage) {
      // Comprobar que existe el botón siguiente antes de hacer click
      const hasNext = await page.$(NEXT_SEL)
      if (!hasNext) {
        console.warn(`[padelmania] No se encontró botón "siguiente" en página ${pageNum}`)
        break
      }

      pageNum++
      console.log(`[padelmania] Página ${pageNum}/${lastPage} (click siguiente)…`)

      // Click y esperar a que cargue la nueva lista de productos
      await Promise.all([
        page.waitForResponse(
          r => r.url().includes('338-todas-las-palas') && r.status() < 400,
          { timeout: 15_000 }
        ).catch(() => null),  // si no hay request de red (solo AJAX parcial), ignorar
        page.click(NEXT_SEL),
      ])
      await page.waitForTimeout(DELAY_MS)

      try {
        await page.waitForSelector('article.product-miniature, .js-product-miniature', { timeout: 12_000 })
      } catch {
        console.warn(`[padelmania] Sin productos en página ${pageNum} — fin de paginación`)
        break
      }

      const products = await extractProducts(page)
      console.log(`[padelmania]  → ${products.length} productos en página ${pageNum}/${lastPage}`)
      addProducts(products)
    }
  } catch (err) {
    console.error('[padelmania] Error:', err.message)
  }

  for (const rebajasUrl of rebajasUrls) {
    try {
      await page.goto(rebajasUrl, { waitUntil: 'domcontentloaded', timeout: 40_000 })
      await page.waitForTimeout(1500)
      await page.waitForSelector('article.product-miniature, .js-product-miniature', { timeout: 10_000 })
      const products = await extractProducts(page)
      let added = 0
      for (const p of products) {
        if (!isPala(p.title) || seen.has(p.url)) continue
        seen.add(p.url)
        const original = p.original ?? NaN
        allProducts.push({
          title:           p.title, price: p.price,
          precio_original: (!isNaN(original) && original > p.price) ? original : null,
          url: p.url, image: p.image,
        })
        added++
      }
      console.log(`[padelmania] sección rebajas ${rebajasUrl} → ${added} productos nuevos`)
    } catch (e) {
      console.error(`[padelmania] Error sección rebajas ${rebajasUrl}:`, e.message)
    }
    await page.waitForTimeout(DELAY_MS)
  }

  await browser.close()

  console.log(`[padelmania] Total palas: ${allProducts.length}`)
  const scraped_at = new Date().toISOString()
  const resultado = allProducts.map(p => ({
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
