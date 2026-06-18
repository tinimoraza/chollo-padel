// scripts/prices/scrapers/time2padel.js
// Time2Padel — PrestaShop HTML scraping
// URL: https://www.time2padel.com/es/5-palas-de-padel
// Plataforma: PrestaShop (patrón similar a ofertasdepadel.com)
// Paginación: ?page=2
//
// NOTA (fix 2026-06-18): la URL "/es/palas-de-padel" (sin ID) da 404 — PrestaShop
// regeneró el slug con el ID delante: "/es/5-palas-de-padel". Los selectores
// (article.product-miniature, .product-title, etc.) seguían siendo correctos.
//
// Ejecutar:
//   node scripts/prices/pipeline.js time2padel

const SOURCE_KEY   = 'time2padel'
const BASE_URL     = 'https://www.time2padel.com'
const CATEGORY_URL = `${BASE_URL}/es/5-palas-de-padel`
const DELAY_MS     = 1200
const MAX_PAGES    = 60

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Language': 'es-ES,es;q=0.9',
}

const EXCLUIR = ['zapatilla', 'mochila', 'paletero', 'bolsa', 'grip', 'overgrip',
  'pelota', 'pelotas', 'camiseta', 'short', 'polo', 'funda', 'muñequera', 'protector',
  'cordaje', 'antivibrador', 'visera', 'gorra', 'calcetín', 'ropa', 'pack ']

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function parsePrice(text) {
  if (!text) return NaN
  return parseFloat(text.replace(/[^\d,]/g, '').replace(',', '.'))
}

async function scrape() {
  console.log('[time2padel] Iniciando scraper (PrestaShop HTML)…')

  let cheerio
  try {
    cheerio = require('cheerio')
  } catch {
    console.error('[time2padel] cheerio no instalado')
    return []
  }

  const allProducts = []
  const seen = new Set()
  let pageNum = 1
  let hasMore = true

  while (hasMore && pageNum <= MAX_PAGES) {
    const url = pageNum === 1
      ? CATEGORY_URL
      : `${CATEGORY_URL}?page=${pageNum}`

    console.log(`[time2padel]   Página ${pageNum}: ${url}`)

    let html
    try {
      const res = await fetch(url, { headers: HEADERS })
      if (!res.ok) { console.log(`[time2padel]   HTTP ${res.status} — fin`); break }
      html = await res.text()
    } catch (err) {
      console.error(`[time2padel]   Error:`, err.message)
      break
    }

    const $ = cheerio.load(html)
    const pageProducts = []

    $('article.product-miniature').each((_, el) => {
      const $el = $(el)
      const title = $el.find('.product-title a').first().text().trim()
        || $el.find('h3.product-title').first().text().trim()
      if (!title || !isPala(title)) return

      const link = $el.find('a.product-thumbnail').first().attr('href')
        || $el.find('.product-title a').first().attr('href')
      if (!link || !link.startsWith('http') || seen.has(link)) return
      seen.add(link)

      const priceText    = $el.find('span.product-price').first().text()
      const originalText = $el.find('span.regular-price').first().text()
      const price    = parsePrice(priceText)
      const original = parsePrice(originalText)

      if (isNaN(price) || price < 30) return

      pageProducts.push({
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url: link,
      })
    })

    // Fallback: intentar selector estándar PrestaShop alternativo si no hubo resultados
    if (pageProducts.length === 0) {
      $('.js-product-miniature, .product_item').each((_, el) => {
        const $el = $(el)
        const title = $el.find('.product-title, h2.product-title, .product-name').first().text().trim()
        if (!title || !isPala(title)) return
        const link = $el.find('a').first().attr('href')
        if (!link || seen.has(link)) return
        seen.add(link)
        const priceText = $el.find('.price, .product-price').first().text()
        const price = parsePrice(priceText)
        if (isNaN(price) || price < 30) return
        pageProducts.push({ title, price, precio_original: null, url: link })
      })
    }

    console.log(`[time2padel]   → ${pageProducts.length} palas en página ${pageNum}`)
    allProducts.push(...pageProducts)

    hasMore = $('a[rel="next"]').length > 0
    pageNum++
    if (hasMore) await sleep(DELAY_MS)
  }

  console.log(`[time2padel] Total palas: ${allProducts.length}`)
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
