// scripts/prices/scrapers/romasport.js
// Scraper Roma Sport — WooCommerce REST API
//
// WooCommerce expone GET /wp-json/wc/v3/products?category=<id>&per_page=100&page=N
// A veces requiere Consumer Key/Secret, a veces está abierto.
// Fallback: scraping HTML de /categoria-producto/padel/padel-palas/ con paginación.
//
// Ejecutar manualmente:
//   node scripts/prices/pipeline.js romasport

const SOURCE_KEY = 'romasport'
const BASE_URL   = 'https://romasport.es'

// Slug de la categoría WooCommerce de palas (de la URL /categoria-producto/padel/padel-palas/)
const CATEGORY_SLUG = 'padel-palas'
const CATEGORY_URL  = `${BASE_URL}/categoria-producto/padel/padel-palas/`

const DELAY_MS = 1000

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ── Intento 1: WooCommerce REST API ─────────────────────────────────────────
// Si la tienda tiene la API abierta sin auth devuelve JSON limpio.
// La URL con el slug de categoría es la más directa.

async function fetchApiPage(page) {
  const url = `${BASE_URL}/wp-json/wc/v3/products?category=${CATEGORY_SLUG}&per_page=100&page=${page}&status=publish`
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    })
    if (res.status === 401 || res.status === 403) return { blocked: true }
    if (!res.ok) return { blocked: true }
    const data = await res.json()
    // La API devuelve array de productos
    if (!Array.isArray(data)) return { blocked: true }
    return { products: data }
  } catch {
    return { blocked: true }
  }
}

async function scrapeViaApi() {
  console.log('[romasport] Intentando WooCommerce REST API…')
  const all = []
  let page = 1

  while (true) {
    const result = await fetchApiPage(page)
    if (result.blocked) {
      console.log('[romasport] API bloqueada o requiere auth — usando scraping HTML')
      return null // señal para usar fallback HTML
    }

    const { products } = result
    console.log(`[romasport]   API página ${page}: ${products.length} productos`)
    all.push(...products)

    if (products.length < 100) break
    page++
    await sleep(DELAY_MS)
  }

  return all.map(p => {
    const price = parseFloat(p.price || p.sale_price || p.regular_price || '0')
    const regular = parseFloat(p.regular_price || '0')
    return {
      title:           p.name,
      price,
      precio_original: regular > price ? regular : null,
      url:             p.permalink,
    }
  }).filter(p => p.title && p.price > 0)
}

// ── Intento 2: Scraping HTML con cheerio ─────────────────────────────────────

async function scrapeViaHtml() {
  console.log('[romasport] Scraping HTML…')

  // Necesita cheerio — instalado como dependencia del proyecto
  let cheerio
  try { cheerio = require('cheerio') } catch {
    console.error('[romasport] cheerio no instalado — npm install cheerio')
    return []
  }

  const all = []
  let pageNum = 1

  while (true) {
    const url = pageNum === 1
      ? CATEGORY_URL
      : `${CATEGORY_URL}page/${pageNum}/`

    console.log(`[romasport]   HTML página ${pageNum}: ${url}`)

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
    })

    if (!res.ok) {
      console.log(`[romasport] HTTP ${res.status} — fin de paginación`)
      break
    }

    const html = await res.text()
    const $ = cheerio.load(html)

    const products = []

    // WooCommerce estándar: .products .product o li.product
    $('li.product, .product').each((_, el) => {
      const $el      = $(el)
      const titleEl  = $el.find('.woocommerce-loop-product__title, h2.woocommerce-loop-product__title, .product-title')
      const priceEl  = $el.find('.price ins .amount, .price .amount').first()
      const origEl   = $el.find('.price del .amount').first()
      const linkEl   = $el.find('a.woocommerce-loop-product__link, a').first()

      const title = titleEl.text().trim()
      const priceText = priceEl.text().replace(/[^\d,.]/g, '').replace(',', '.')
      const origText  = origEl.text().replace(/[^\d,.]/g, '').replace(',', '.')
      const url       = linkEl.attr('href') ?? ''

      const price    = parseFloat(priceText)
      const original = parseFloat(origText)

      if (!title || !price || isNaN(price)) return
      if (!url.startsWith('http')) return

      products.push({
        title,
        price,
        precio_original: !isNaN(original) && original > price ? original : null,
        url,
      })
    })

    console.log(`[romasport]   → ${products.length} productos en página ${pageNum}`)

    if (products.length === 0) break
    all.push(...products)

    // Comprobar si hay página siguiente
    const hasNext = $('a.next.page-numbers').length > 0
    if (!hasNext) break

    pageNum++
    await sleep(DELAY_MS)
  }

  return all
}

async function scrape() {
  console.log('[romasport] Iniciando scraper…')

  // Intentar API primero, si falla usar HTML
  let products = await scrapeViaApi()
  if (products === null) {
    products = await scrapeViaHtml()
  }

  // Deduplicar por URL
  const seen = new Set()
  const unique = products.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[romasport] Total palas: ${unique.length}`)

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
