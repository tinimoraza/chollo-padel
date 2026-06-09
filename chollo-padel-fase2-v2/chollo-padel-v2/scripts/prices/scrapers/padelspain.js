// scripts/prices/scrapers/padelspain.js
// Padel-Spain — PrestaShop HTML scraping
// URL: https://www.padel-spain.es
// Plataforma: PrestaShop probable (Tier 1 masterlist)
//
// Ejecutar:
//   node scripts/prices/pipeline.js padelspain

const SOURCE_KEY   = 'padelspain'
const BASE_URL     = 'https://www.padel-spain.es'
const DELAY_MS     = 1200
const MAX_PAGES    = 40

// URLs de categoría a probar (PrestaShop puede variar el slug)
const CATEGORY_CANDIDATES = [
  `${BASE_URL}/palas-padel`,
  `${BASE_URL}/es/palas-de-padel`,
  `${BASE_URL}/es/palas-padel`,
  `${BASE_URL}/palas-de-padel`,
]

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Language': 'es-ES,es;q=0.9',
}

const EXCLUIR = ['zapatilla', 'mochila', 'paletero', 'bolsa', 'grip', 'overgrip',
  'pelota', 'pelotas', 'camiseta', 'funda', 'muñequera', 'protector', 'pack ']

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function parsePrice(text) {
  if (!text) return NaN
  return parseFloat(text.replace(/[^\d,]/g, '').replace(',', '.'))
}

async function findCategoryUrl() {
  for (const url of CATEGORY_CANDIDATES) {
    try {
      const res = await fetch(url, { headers: HEADERS })
      if (res.ok) { console.log(`[padelspain] Categoría encontrada: ${url}`); return url }
    } catch { continue }
  }
  return null
}

async function scrape() {
  console.log('[padelspain] Iniciando scraper (PrestaShop HTML)…')

  let cheerio
  try { cheerio = require('cheerio') } catch {
    console.error('[padelspain] cheerio no instalado'); return []
  }

  const categoryUrl = await findCategoryUrl()
  if (!categoryUrl) {
    console.error('[padelspain] ⚠️  No se encontró URL de categoría válida — revisar manualmente')
    return []
  }

  const allProducts = []
  const seen = new Set()
  let pageNum = 1
  let hasMore = true

  while (hasMore && pageNum <= MAX_PAGES) {
    const url = pageNum === 1 ? categoryUrl : `${categoryUrl}?page=${pageNum}`
    console.log(`[padelspain]   Página ${pageNum}: ${url}`)

    let html
    try {
      const res = await fetch(url, { headers: HEADERS })
      if (!res.ok) { console.log(`[padelspain]   HTTP ${res.status}`); break }
      html = await res.text()
    } catch (err) {
      console.error(`[padelspain]   Error:`, err.message); break
    }

    const $ = cheerio.load(html)
    const pageProducts = []

    // Selectores PrestaShop estándar
    $('article.product-miniature, .js-product-miniature').each((_, el) => {
      const $el = $(el)
      const title = $el.find('.product-title a, h3.product-title a').first().text().trim()
      if (!title || !isPala(title)) return
      const link = $el.find('a.product-thumbnail, .product-title a').first().attr('href')
      if (!link || !link.startsWith('http') || seen.has(link)) return
      seen.add(link)
      const price    = parsePrice($el.find('span.product-price').first().text())
      const original = parsePrice($el.find('span.regular-price').first().text())
      if (isNaN(price) || price < 30) return
      pageProducts.push({
        title, price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url: link,
      })
    })

    console.log(`[padelspain]   → ${pageProducts.length} palas en página ${pageNum}`)
    allProducts.push(...pageProducts)

    hasMore = $('a[rel="next"]').length > 0
    pageNum++
    if (hasMore) await sleep(DELAY_MS)
  }

  console.log(`[padelspain] Total palas: ${allProducts.length}`)
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
