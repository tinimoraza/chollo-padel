// scripts/prices/scrapers/siux.js
// Siux tienda oficial — Shopify JSON API (probable) con fallback HTML
// URL: https://siux.es/collections/palas
// NOTA: PVP oficial — útil como precio techo
//
// Ejecutar:
//   node scripts/prices/pipeline.js siux

const SOURCE_KEY = 'siux'
const BASE_URL   = 'https://siux.es'
const LIMIT      = 250
const DELAY_MS   = 700

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla']

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

// Colecciones que pueden contener palas
const COLLECTIONS = ['palas', 'padel', 'all']

async function tryShopify() {
  for (const col of COLLECTIONS) {
    const url = `${BASE_URL}/collections/${col}/products.json?limit=${LIMIT}`
    console.log(`[siux] Probando Shopify: ${url}`)
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      })
      if (!res.ok) continue
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('json')) continue
      const data = await res.json()
      if (data.products?.length > 0) {
        console.log(`[siux] Shopify encontrado en /collections/${col}: ${data.products.length} productos`)
        return { collection: col, products: data.products }
      }
    } catch { continue }
  }
  return null
}

async function scrape() {
  console.log('[siux] Iniciando scraper…')

  const seen = new Set()
  const allProducts = []

  // Intentar Shopify API
  let page = 1
  const shopifyRes = await tryShopify()

  if (shopifyRes) {
    const col = shopifyRes.collection
    let products = shopifyRes.products

    // Paginar si hay más
    while (products.length === LIMIT) {
      page++
      const url = `${BASE_URL}/collections/${col}/products.json?limit=${LIMIT}&page=${page}`
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
      if (!res.ok) break
      const data = await res.json()
      if (!data.products?.length) break
      products = [...products, ...data.products]
      await sleep(DELAY_MS)
    }

    for (const p of products) {
      if (!isPala(p.title)) continue
      const variant = p.variants?.[0]
      if (!variant) continue
      const price   = parseFloat(variant.price)
      const compare = parseFloat(variant.compare_at_price)
      const pUrl    = `${BASE_URL}/products/${p.handle}`
      if (isNaN(price) || price < 30 || seen.has(pUrl)) continue
      seen.add(pUrl)
      allProducts.push({
        title: p.title,
        price,
        precio_original: (!isNaN(compare) && compare > price) ? compare : null,
        url: pUrl,
      })
    }
  } else {
    console.log('[siux] ⚠️  Shopify no disponible — scraper HTML necesita implementación manual')
    console.log('[siux] Visita https://siux.es/collections/palas para inspeccionar la plataforma')
  }

  console.log(`[siux] Total palas: ${allProducts.length}`)
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
