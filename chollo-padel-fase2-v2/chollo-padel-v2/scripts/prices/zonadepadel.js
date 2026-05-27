// scripts/prices/scrapers/zonadepadel.js
// Scraper Zona de Padel — PrestaShop
//
// PrestaShop tiene varias formas de paginación. Intentamos:
// 1. Endpoint FacetWP/módulo de búsqueda avanzada (igual que Padelzoom)
// 2. Fallback: scraping HTML de la categoría de palas con paginación estándar
//
// Ejecutar manualmente:
//   node scripts/prices/pipeline.js zonadepadel

const SOURCE_KEY   = 'zonadepadel'
const BASE_URL     = 'https://zonadepadel.es'
// URL de la categoría de palas — ajustar si la URL real es diferente
const CATEGORY_URL = `${BASE_URL}/12-palas-de-padel`
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

// ── Intento 1: endpoint JSON de PrestaShop (módulo búsqueda avanzada) ────────

async function scrapeViaApi() {
  console.log('[zonadepadel] Intentando endpoint JSON PrestaShop…')

  // PrestaShop con pm_advancedsearch o blockwishlist suele exponer un endpoint POST
  // Probamos la URL más común con el id de categoría de palas
  const endpoints = [
    `${BASE_URL}/index.php?fc=module&module=pm_advancedsearch4&controller=SearchProductsAjax`,
    `${BASE_URL}/index.php?fc=module&module=blocklayered&controller=blocklayered`,
  ]

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: 'id_category_layered=12&n=100&p=1',
      })
      if (!res.ok) continue
      const text = await res.text()
      if (!text.startsWith('{') && !text.startsWith('[')) continue
      const data = JSON.parse(text)
      // Si devuelve productos en algún formato conocido
      const products = data?.products ?? data?.items ?? data?.data ?? []
      if (Array.isArray(products) && products.length > 0) {
        console.log(`[zonadepadel] API encontrada: ${products.length} productos`)
        return products
      }
    } catch { continue }
  }

  console.log('[zonadepadel] API no disponible — usando scraping HTML')
  return null
}

// ── Intento 2: Scraping HTML ──────────────────────────────────────────────────

async function scrapeViaHtml() {
  console.log('[zonadepadel] Scraping HTML…')

  let cheerio
  try { cheerio = require('cheerio') } catch {
    console.error('[zonadepadel] cheerio no instalado — npm install cheerio')
    return []
  }

  const all = []
  let pageNum = 1

  while (true) {
    const url = pageNum === 1
      ? CATEGORY_URL
      : `${CATEGORY_URL}?p=${pageNum}`

    console.log(`[zonadepadel]   HTML página ${pageNum}: ${url}`)

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
    })

    if (!res.ok) {
      console.log(`[zonadepadel] HTTP ${res.status} — fin`)
      break
    }

    const html = await res.text()
    const $ = cheerio.load(html)
    const products = []

    // PrestaShop estándar: .product-miniature o article.product-miniature
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

    console.log(`[zonadepadel]   → ${products.length} palas en página ${pageNum}`)
    if (products.length === 0) break
    all.push(...products)

    // Siguiente página
    const hasNext = $('a.next, .next a, li.next a, a[rel="next"]').length > 0
    if (!hasNext) break

    pageNum++
    await sleep(DELAY_MS)
  }

  return all
}

async function scrape() {
  console.log('[zonadepadel] Iniciando scraper…')

  let raw = await scrapeViaApi()
  let products = []

  if (raw && raw.length > 0) {
    // Mapear desde formato API PrestaShop
    products = raw.map(p => ({
      title:           p.name ?? p.title ?? '',
      price:           parseFloat(p.price_amount ?? p.price ?? '0'),
      precio_original: parseFloat(p.regular_price_amount ?? p.regular_price ?? '0') || null,
      url:             p.url ?? p.link ?? '',
    })).filter(p => p.title && p.price > 0 && p.url)
  } else {
    products = await scrapeViaHtml()
  }

  const seen = new Set()
  const unique = products.filter(p => {
    if (!p.url || seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[zonadepadel] Total palas: ${unique.length}`)

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
