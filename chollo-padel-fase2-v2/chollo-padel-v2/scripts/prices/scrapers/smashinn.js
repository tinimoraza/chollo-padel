// scripts/prices/scrapers/smashinn.js
// Smashinn (TradeInn group) — API JSON interna
// Plataforma: TradeInn proprietary
// URL palas pádel: https://www.tradeinn.com/smashinn/es/padel-palas/5010/s
// API: POST a endpoint de búsqueda con filtro de categoría
//
// NOTA: Smashinn vende internacional con precios en USD/EUR variables.
//       Usar solo como referencia secundaria, no como precio_referencia principal.
//
// Ejecutar:
//   node scripts/prices/pipeline.js smashinn

const SOURCE_KEY = 'smashinn'
const BASE_URL   = 'https://www.tradeinn.com'
const DELAY_MS   = 1000
const MAX_PAGES  = 20

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla',
  'string', 'ball', 'bag', 'shoe', 'shoes', 'clothing', 'shirt']

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

async function scrape() {
  console.log('[smashinn] Iniciando scraper (TradeInn API)…')

  const allProducts = []
  const seen = new Set()
  let page = 0

  while (page < MAX_PAGES) {
    // TradeInn API — endpoint de búsqueda con categoría de palas de pádel (cat=5010)
    const url = `${BASE_URL}/api/searchProducts` +
      `?store=smashinn&lang=es&country=ES` +
      `&category=5010&subcategory=&page=${page}&num=48&sort=0`

    console.log(`[smashinn]   Página ${page + 1}: ${url}`)

    let data
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://www.tradeinn.com/smashinn/es/padel-palas/5010/s',
        },
      })
      if (!res.ok) {
        console.log(`[smashinn] HTTP ${res.status} — deteniendo`)
        break
      }
      data = await res.json()
    } catch (err) {
      console.error(`[smashinn] Error en página ${page}:`, err.message)
      break
    }

    const products = data?.products ?? data?.results ?? data ?? []
    if (!Array.isArray(products) || products.length === 0) {
      console.log(`[smashinn] Sin productos en página ${page + 1} — fin`)
      break
    }

    console.log(`[smashinn]  → ${products.length} productos`)

    for (const p of products) {
      const title = p.name ?? p.title ?? p.model ?? ''
      if (!title || !isPala(title)) continue

      const url     = p.url ? `${BASE_URL}${p.url}` : (p.permalink ?? '')
      const price   = parseFloat(p.price ?? p.current_price ?? 0)
      const compare = parseFloat(p.original_price ?? p.regular_price ?? 0)

      if (!url || isNaN(price) || price < 30 || seen.has(url)) continue
      seen.add(url)

      allProducts.push({
        title,
        price,
        precio_original: (!isNaN(compare) && compare > price) ? compare : null,
        url,
      })
    }

    if (products.length < 48) break
    page++
    await sleep(DELAY_MS)
  }

  console.log(`[smashinn] Total palas: ${allProducts.length}`)
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
