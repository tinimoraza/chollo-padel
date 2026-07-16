// scripts/prices/scrapers/time2padel.js
// Time2Padel — PrestaShop, Playwright (Cloudflare bloquea fetch/cheerio básico)
// La categoría principal tiene 444 palas en múltiples páginas; Cloudflare bloquea
// la paginación (?page=2+) en la misma sesión. Estrategia: extraer subcategorías
// por marca de la página principal y scrapearlas individualmente — cada una tiene
// pocas palas y son URLs distintas que Cloudflare no correlaciona.
//
// NOTA (fix 2026-06-18): URL cambió a /es/5-palas-de-padel (con ID).
// NOTA (fix 2026-07-16): migrado de cheerio+fetch a Playwright — HTTP 403 de Cloudflare.
// NOTA (fix 2026-07-16b): estrategia subcategorías por marca para cubrir las 444 palas.

const SOURCE_KEY   = 'time2padel'
const BASE_URL     = 'https://www.time2padel.com'
const CATEGORY_URL = `${BASE_URL}/es/5-palas-de-padel`
const DELAY_MS     = 3500   // entre subcategorías
const PAGE_DELAY   = 5000   // entre páginas de la misma subcategoría

const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

// Fragmentos que identifican subcategorías de NAVEGACIÓN (nivel/jugador/estilo/outlet)
// — no son marcas, sus palas ya aparecen en la subcategoría de marca correspondiente
const EXCLUIR_SUBCATS = [
  'nivel-', 'hombre', 'mujer', 'junior', 'potencia', 'control', 'polivalente',
  'equilibrio', 'outlet', 'rebajas', 'todos-los-productos', 'paletero', 'zapatilla',
  'mochila', 'accesor', 'indumentaria', 'ropa', 'calzado', 'bolsa',
]

// Palabras en títulos de producto que indican que NO es una pala
const EXCLUIR_TITULO = [
  'zapatilla', 'mochila', 'paletero', 'bolsa', 'grip', 'overgrip',
  'pelota', 'pelotas', 'camiseta', 'short', 'polo', 'funda', 'muñequera',
  'protector', 'cordaje', 'antivibrador', 'visera', 'gorra', 'calcetín',
  'ropa', 'pack ', 'muñeq',
]

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR_TITULO.some(w => t.includes(w))
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

// Extrae subcategorías de marca de la página de categoría principal.
// Devuelve array de URLs absolutas.
async function extraerSubcategorias(page) {
  const hrefs = await page.evaluate((BASE) => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href)
      .filter(h => h.startsWith(BASE + '/es/') && /pala/i.test(h))
  }, BASE_URL)

  const seen = new Set()
  const result = []
  for (const h of hrefs) {
    if (seen.has(h)) continue
    seen.add(h)
    const path = h.replace(BASE_URL, '').toLowerCase()
    // Excluir la categoría principal misma y las de navegación
    if (path === '/es/5-palas-de-padel') continue
    if (path.includes('?')) continue
    if (EXCLUIR_SUBCATS.some(frag => path.includes(frag))) continue
    result.push(h)
  }
  return result
}

// Scrapea todas las páginas de una URL de subcategoría
async function scrapeCategoria(page, catUrl, seen, allProducts) {
  let pageNum = 1
  while (true) {
    const url = pageNum === 1 ? catUrl : `${catUrl}?page=${pageNum}`
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 40000 })
      await page.waitForTimeout(2500)
      await page.waitForSelector(
        'article.product-miniature, .product-miniature, .js-product-miniature',
        { timeout: 20000 }
      )
    } catch {
      const info = await page.evaluate(() => document.title.substring(0, 60)).catch(() => '')
      if (info.includes('Cloudflare') || info.includes('Attention') || info.includes('Error')) {
        console.warn(`[time2padel]   Cloudflare en ${url} — saltando`)
      }
      break
    }

    const products = await extractProducts(page)
    let added = 0
    for (const p of products) {
      if (!isPala(p.title) || seen.has(p.url)) continue
      seen.add(p.url)
      allProducts.push(p)
      added++
    }
    if (added > 0 || pageNum === 1) {
      console.log(`[time2padel]   ${catUrl.split('/es/')[1]} pág ${pageNum} -> ${added} nuevas`)
    }
    if (products.length === 0) break

    const hasNext = await page.evaluate((cur) => (
      !!(document.querySelector(`a[href*="page=${cur + 1}"]`) ||
         document.querySelector('a[rel="next"], .next a, li.next a'))
    ), pageNum)
    if (!hasNext) break

    pageNum++
    await page.waitForTimeout(PAGE_DELAY)
  }
}

async function scrape() {
  console.log('[time2padel] Iniciando scraper (Playwright — subcategorías por marca)...')

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
  let codigoDescuento = null

  try {
    // 1. Cargar categoría principal — extraer código descuento + subcategorías
    console.log(`[time2padel]   Cargando categoría principal...`)
    await page.goto(CATEGORY_URL, { waitUntil: 'load', timeout: 45000 })
    await page.waitForTimeout(3000)

    // Cerrar banner cookies si aparece
    try {
      await page.waitForSelector(
        '.cmplz-accept, [data-cky-tag="accept-button"], #onetrust-accept-btn-handler, .js-btn-accept-all, .cc-btn',
        { timeout: 5000 }
      )
      await page.click('.cmplz-accept, [data-cky-tag="accept-button"], #onetrust-accept-btn-handler, .js-btn-accept-all, .cc-btn')
      await page.waitForTimeout(1000)
    } catch { /* sin banner */ }

    // Detectar código descuento
    const bodyText = await page.evaluate(() => document.body.innerText)
    codigoDescuento = detectarCodigoDescuento(bodyText)
    if (codigoDescuento) {
      console.log(`[time2padel] codigo: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
    }

    // Scrapear la propia página principal (primera página, normalmente 12 palas)
    try {
      await page.waitForSelector(
        'article.product-miniature, .product-miniature, .js-product-miniature',
        { timeout: 15000 }
      )
      const products = await extractProducts(page)
      for (const p of products) {
        if (!isPala(p.title) || seen.has(p.url)) continue
        seen.add(p.url)
        allProducts.push(p)
      }
      console.log(`[time2padel]   pág principal -> ${allProducts.length} palas`)
    } catch { /* sin productos en main */ }

    // Extraer subcategorías de marca
    const subcats = await extraerSubcategorias(page)
    console.log(`[time2padel]   Subcategorías detectadas: ${subcats.length}`)

    // Detectar secciones outlet/rebajas de palas (separadas del flujo de subcategorías)
    const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href))
    const todasRebajas = filtrarUrlsRebajas(hrefs, CATEGORY_URL)
    const rebajasUrls = todasRebajas.filter(u =>
      !(/paletero/i.test(u)) &&
      /palas|outlet.*pad|pad.*outlet/i.test(u)
    )

    // 2. Scrapear cada subcategoría de marca
    for (const cat of subcats) {
      await page.waitForTimeout(DELAY_MS)
      await scrapeCategoria(page, cat, seen, allProducts)
    }

    // 3. Scrapear secciones outlet/rebajas
    for (const rebajasUrl of rebajasUrls) {
      await page.waitForTimeout(DELAY_MS)
      console.log(`[time2padel]   Rebajas: ${rebajasUrl}`)
      await scrapeCategoria(page, rebajasUrl, seen, allProducts)
    }

  } catch (err) {
    console.error('[time2padel] Error:', err.message)
  }

  await context.close()
  await browser.close()

  console.log(`[time2padel] Total palas únicas: ${allProducts.length}`)
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
