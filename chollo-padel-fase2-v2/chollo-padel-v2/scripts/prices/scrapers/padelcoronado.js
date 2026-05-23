// scripts/prices/scrapers/padelcoronado.js
// Scraper Padel Coronado — WooCommerce REST API + fallback HTML
//
// Misma arquitectura que romasport.js: intenta API REST primero,
// si está bloqueada cae a scraping HTML cheerio.
//
// Ejecutar manualmente:
//   node scripts/prices/pipeline.js padelcoronado

const SOURCE_KEY = 'padelcoronado'
const BASE_URL   = 'https://padelcoronado.com'

// De la URL /tienda/?product_cat=palas-de-padel (o similar)
// Fallback a /tienda/ con filtro de categoría en HTML
const CATEGORY_URL = `${BASE_URL}/tienda/?product_cat=palas-de-padel&orderby=date&order=desc`

const DELAY_MS = 1000

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ── Intento 1: WooCommerce REST API ─────────────────────────────────────────

async function fetchApiPage(page) {
  // Intentar con el slug de categoría y también por búsqueda de "pala"
  const url = `${BASE_URL}/wp-json/wc/v3/products?per_page=100&page=${page}&status=publish&category=palas-de-padel`
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    })
    if (res.status === 401 || res.status === 403) return { blocked: true }
    if (!res.ok) return { blocked: true }
    const data = await res.json()
    if (!Array.isArray(data)) return { blocked: true }
    return { products: data }
  } catch {
    return { blocked: true }
  }
}

async function scrapeViaApi() {
  console.log('[padelcoronado] Intentando WooCommerce REST API…')
  const all = []
  let page = 1

  while (true) {
    const result = await fetchApiPage(page)
    if (result.blocked) {
      console.log('[padelcoronado] API bloqueada — usando scraping HTML')
      return null
    }

    const { products } = result
    console.log(`[padelcoronado]   API página ${page}: ${products.length} productos`)
    all.push(...products)

    if (products.length < 100) break
    page++
    await sleep(DELAY_MS)
  }

  return all.map(p => {
    const price   = parseFloat(p.price || p.sale_price || p.regular_price || '0')
    const regular = parseFloat(p.regular_price || '0')
    return {
      title:           p.name,
      price,
      precio_original: regular > price ? regular : null,
      url:             p.permalink,
    }
  }).filter(p => p.title && p.price > 0)
}

// ── Intento 2: Scraping HTML ─────────────────────────────────────────────────

function isBlade(title) {
  const t = title.toLowerCase()
  const EXCLUIR = ['zapatilla', 'mochila', 'paletero', 'bolsa', 'grip',
    'overgrip', 'pelota', 'camiseta', 'short', 'polo', 'funda', 'muñequera',
    'visera', 'gorra', 'calcetín', 'calcetines', 'protector', 'cordaje']
  if (EXCLUIR.some(w => t.includes(w))) return false
  return t.includes('pala')
}

async function fetchHtmlPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html',
    },
  })
  if (!res.ok) return null
  return res.text()
}

async function scrapeViaHtml() {
  console.log('[padelcoronado] Scraping HTML…')

  let cheerio
  try { cheerio = require('cheerio') } catch {
    console.error('[padelcoronado] cheerio no instalado — npm install cheerio')
    return []
  }

  const all = []
  let pageNum = 1

  while (true) {
    const url = pageNum === 1
      ? CATEGORY_URL
      : `${CATEGORY_URL}&paged=${pageNum}`

    console.log(`[padelcoronado]   HTML página ${pageNum}: ${url}`)

    const html = await fetchHtmlPage(url)
    if (!html) { console.log('[padelcoronado] Sin respuesta, fin'); break }

    const $ = cheerio.load(html)
    const products = []

    $('li.product, .type-product').each((_, el) => {
      const $el     = $(el)
      const title   = $el.find('.woocommerce-loop-product__title, h2').first().text().trim()
      // Padelcoronado muestra precio con IVA explícito. Capturamos el precio actual.
      const priceEl = $el.find('.price ins .amount, .price .woocommerce-Price-amount').first()
      const origEl  = $el.find('.price del .amount').first()
      const link    = $el.find('a').first().attr('href') ?? ''

      const priceText = priceEl.text().replace(/[^\d,.]/g, '').replace(',', '.')
      const origText  = origEl.text().replace(/[^\d,.]/g, '').replace(',', '.')
      const price     = parseFloat(priceText)
      const original  = parseFloat(origText)

      if (!title || !price || isNaN(price) || !link.startsWith('http')) return
      if (!isBlade(title)) return

      products.push({
        title,
        price,
        precio_original: !isNaN(original) && original > price ? original : null,
        url: link,
      })
    })

    console.log(`[padelcoronado]   → ${products.length} palas en página ${pageNum}`)
    if (products.length === 0) break
    all.push(...products)

    const hasNext = $('a.next.page-numbers').length > 0
    if (!hasNext) break

    pageNum++
    await sleep(DELAY_MS)
  }

  return all
}

async function scrape() {
  console.log('[padelcoronado] Iniciando scraper…')

  let products = await scrapeViaApi()
  if (products === null) {
    products = await scrapeViaHtml()
  }

  const seen = new Set()
  const unique = products.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[padelcoronado] Total palas: ${unique.length}`)

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
