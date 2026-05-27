// scripts/prices/scrapers/padelproshop.js
// Scraper PadelPROShop — Shopify
//
// Shopify expone GET /collections/<handle>/products.json?limit=250&page=N
// Sin auth, completamente público.
//
// Ejecutar manualmente:
//   node scripts/prices/pipeline.js padelproshop

const SOURCE_KEY    = 'padelproshop'
const BASE_URL      = 'https://padelproshop.com'
const COLLECTION    = 'palas-de-padel'
const DELAY_MS      = 800

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

async function fetchPage(page) {
  const url = `${BASE_URL}/collections/${COLLECTION}/products.json?limit=250&page=${page}`
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    })
    if (!res.ok) {
      console.log(`[padelproshop] HTTP ${res.status} en página ${page}`)
      return []
    }
    const data = await res.json()
    return data.products ?? []
  } catch (err) {
    console.error(`[padelproshop] Error en página ${page}:`, err.message)
    return []
  }
}

async function scrape() {
  console.log('[padelproshop] Iniciando scraper (Shopify)…')

  const all = []
  let page = 1

  while (true) {
    console.log(`[padelproshop]   Página ${page}…`)
    const products = await fetchPage(page)
    if (products.length === 0) break

    all.push(...products)
    console.log(`[padelproshop]   → ${products.length} productos`)

    if (products.length < 250) break
    page++
    await sleep(DELAY_MS)
  }

  const scraped_at = new Date().toISOString()
  const seen = new Set()
  const result = []

  for (const product of all) {
    if (!isPala(product.title)) continue

    // Shopify: cada variant puede tener precio distinto — cogemos el más bajo disponible
    const variants = product.variants ?? []
    const availableVariants = variants.filter(v => v.available !== false)
    const targetVariants = availableVariants.length > 0 ? availableVariants : variants
    if (targetVariants.length === 0) continue

    const prices = targetVariants.map(v => parseFloat(v.price)).filter(p => p > 0)
    const comparePrices = targetVariants.map(v => parseFloat(v.compare_at_price || '0')).filter(p => p > 0)

    if (prices.length === 0) continue

    const price = Math.min(...prices)
    const compare = comparePrices.length > 0 ? Math.max(...comparePrices) : null

    const url = `${BASE_URL}/products/${product.handle}`
    if (seen.has(url)) continue
    seen.add(url)

    result.push({
      source_key:      SOURCE_KEY,
      title:           product.title,
      price,
      precio_original: compare && compare > price ? compare : null,
      url,
      scraped_at,
    })
  }

  console.log(`[padelproshop] Total palas: ${result.length}`)
  return result
}

module.exports = { scrape, SOURCE_KEY }
