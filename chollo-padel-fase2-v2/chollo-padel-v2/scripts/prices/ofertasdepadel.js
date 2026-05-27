// scripts/prices/scrapers/ofertasdepadel.js
// Scraper Ofertas de Pádel — PrestaShop
//
// Especializado en outlet y ofertas — clave para detectar chollos.
// Misma arquitectura que zonadepadel.js.
//
// Ejecutar manualmente:
//   node scripts/prices/pipeline.js ofertasdepadel

const SOURCE_KEY   = 'ofertasdepadel'
const BASE_URL     = 'https://ofertasdepadel.com'
const CATEGORY_URL = `${BASE_URL}/es/palas`
const DELAY_MS     = 1000

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

const EXCLUIR = [
  'zapatilla', 'mochila', 'paletero', 'bolsa', 'grip', 'overgrip',
  'pelota', 'pelotas', 'camiseta', 'short', 'polo', 'funda',
  'muñequera', 'visera', 'gorra', 'calcetín', 'calcetines',
  'protector', 'cordaje', 'antivibrador',
]

function isPala(title) {
  const t = title.toLowerCase()
  if (EXCLUIR.some(w => t.includes(w))) return false
  return true
}

async function scrapeViaHtml() {
  console.log('[ofertasdepadel] Scraping HTML…')

  let cheerio
  try { cheerio = require('cheerio') } catch {
    console.error('[ofertasdepadel] cheerio no instalado — npm install cheerio')
    return []
  }

  const all = []
  let pageNum = 1

  while (true) {
    const url = pageNum === 1
      ? CATEGORY_URL
      : `${CATEGORY_URL}?p=${pageNum}`

    console.log(`[ofertasdepadel]   HTML página ${pageNum}: ${url}`)

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
    })

    if (!res.ok) {
      console.log(`[ofertasdepadel] HTTP ${res.status} — fin`)
      break
    }

    const html = await res.text()
    const $ = cheerio.load(html)
    const products = []

    $('article.product-miniature, .product-miniature, .js-product').each((_, el) => {
      const $el = $(el)

      const title   = $el.find('.product-title, h3.product-title, .product-name').first().text().trim()
      const link    = $el.find('a.product-thumbnail, a.product-title, h3 a').first().attr('href') ?? ''
      const priceEl = $el.find('.price, .product-price, span.price').first()
      const origEl  = $el.find('.regular-price, s.regular-price, .price-old').first()

      const priceText = priceEl.text().replace(/[^\d,.]/g, '').replace(',', '.')
      const origText  = origEl.text().replace(/[^\d,.]/g, '').replace(',', '.')
      const price     = parseFloat(priceText)
      const original  = parseFloat(origText)

      if (!title || !price || isNaN(price)) return
      if (!link.startsWith('http')) return
      if (!isPala(title)) return

      products.push({
        title,
        price,
        precio_original: !isNaN(original) && original > price ? original : null,
        url: link,
      })
    })

    console.log(`[ofertasdepadel]   → ${products.length} palas en página ${pageNum}`)
    if (products.length === 0) break
    all.push(...products)

    const hasNext = $('a.next, .next a, li.next a, a[rel="next"]').length > 0
    if (!hasNext) break

    pageNum++
    await sleep(DELAY_MS)
  }

  return all
}

async function scrape() {
  console.log('[ofertasdepadel] Iniciando scraper…')

  const products = await scrapeViaHtml()

  const seen = new Set()
  const unique = products.filter(p => {
    if (!p.url || seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[ofertasdepadel] Total palas: ${unique.length}`)

  const scraped_at = new Date().toISOString()
  return unique.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original && p.precio_original > p.price ? p.precio_original : null,
    url:             p.url,
    scraped_at,
  }))
}

module.exports = { scrape, SOURCE_KEY }
