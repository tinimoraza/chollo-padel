// scripts/prices/scrapers/ofertasdepadel.js
// Scraper Ofertas de Pádel — PrestaShop HTML
//
// URL: https://www.ofertasdepadel.com/es/3-palas-de-padel
// 426 palas (aprox), 12 por página → ~36 páginas
// Paginación: ?page=2, ?page=3...
// Selectores verificados inspeccionando el DOM en vivo:
//   artículo:       article.product-miniature[data-id-product]
//   link:           a.product-thumbnail (href)
//   título:         .product-title a
//   precio actual:  span.product-price
//   precio original: span.regular-price
//   siguiente pág:  a[rel="next"]
//
// Ejecutar manualmente:
//   node scripts/prices/pipeline.js ofertasdepadel

const SOURCE_KEY   = 'ofertasdepadel'
const BASE_URL     = 'https://www.ofertasdepadel.com'
const CATEGORY_URL = `${BASE_URL}/es/3-palas-de-padel`
const DELAY_MS     = 1200   // respetuoso con el servidor
const MAX_PAGES    = 50     // techo de seguridad

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Language': 'es-ES,es;q=0.9',
}

// Productos no pala que pueden colar aunque estén en la categoría
const EXCLUIR = [
  'zapatilla', 'mochila', 'paletero', 'bolsa', 'grip', 'overgrip',
  'pelota', 'pelotas', 'camiseta', 'short', 'polo', 'funda',
  'muñequera', 'visera', 'gorra', 'calcetín', 'calcetines',
  'protector', 'cordaje', 'antivibrador', 'pack ', 'kit ',
  'portabotellas', 'ropa', 'cuerda',
]

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function parsePrice(text) {
  if (!text) return NaN
  // "154,95 €" → 154.95
  return parseFloat(text.replace(/[^\d,]/g, '').replace(',', '.'))
}

async function scrape() {
  console.log('[ofertasdepadel] Iniciando scraper (PrestaShop HTML)…')

  let cheerio
  try {
    cheerio = require('cheerio')
  } catch {
    console.error('[ofertasdepadel] cheerio no instalado — ejecuta: npm install cheerio')
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

    console.log(`[ofertasdepadel]   Página ${pageNum}: ${url}`)

    let html
    try {
      const res = await fetch(url, { headers: HEADERS })
      if (!res.ok) {
        console.log(`[ofertasdepadel]   HTTP ${res.status} — deteniendo`)
        break
      }
      html = await res.text()
    } catch (err) {
      console.error(`[ofertasdepadel]   Error fetch página ${pageNum}:`, err.message)
      break
    }

    const $ = cheerio.load(html)
    const pageProducts = []

    $('article.product-miniature').each((_, el) => {
      const $el = $(el)

      // Título
      const title = $el.find('.product-title a').first().text().trim()
        || $el.find('h3.product-title').first().text().trim()
      if (!title) return

      // Filtrar no-palas
      if (!isPala(title)) return

      // URL producto
      const link = $el.find('a.product-thumbnail').first().attr('href')
        || $el.find('.product-title a').first().attr('href')
      if (!link || !link.startsWith('http')) return

      // Deduplicar
      if (seen.has(link)) return
      seen.add(link)

      // Precios
      const priceText    = $el.find('span.product-price').first().text()
      const originalText = $el.find('span.regular-price').first().text()

      const price    = parsePrice(priceText)
      const original = parsePrice(originalText)

      if (isNaN(price) || price < 30) return  // precio mínimo razonable para una pala

      // Imagen — PrestaShop suele hacer lazy-load (data-src con la url real,
      // "src" empieza siendo un placeholder base64/1x1). Descartamos "data:".
      const imgEl  = $el.find('a.product-thumbnail img, img').first()
      const rawImg = imgEl.attr('data-src') || imgEl.attr('src') || ''
      const image  = rawImg.startsWith('data:') ? null : (rawImg.split('?')[0] || null)

      pageProducts.push({
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url: link,
        image,
      })
    })

    console.log(`[ofertasdepadel]   → ${pageProducts.length} palas en página ${pageNum}`)
    allProducts.push(...pageProducts)

    // Comprobar si hay página siguiente
    hasMore = $('a[rel="next"]').length > 0
    pageNum++

    if (hasMore) await sleep(DELAY_MS)
  }

  console.log(`[ofertasdepadel] Total palas: ${allProducts.length}`)

  const scraped_at = new Date().toISOString()
  return allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    image:           p.image ?? null,
    scraped_at,
  }))
}

module.exports = { scrape, SOURCE_KEY }
