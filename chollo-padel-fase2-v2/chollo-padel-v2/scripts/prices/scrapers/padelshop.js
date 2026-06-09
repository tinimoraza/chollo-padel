// scripts/prices/scrapers/padelshop.js
// PadelShop — Shopify JSON API (probable, 3K reseñas Trustpilot)
// URL: https://www.padelshop.com
//
// Ejecutar:
//   node scripts/prices/pipeline.js padelshop

const SOURCE_KEY = 'padelshop'
const DELAY_MS   = 700
const LIMIT      = 250

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla', 'shoe']

function isPala(title) {
  return !EXCLUIR.some(w => title.toLowerCase().includes(w))
}

const CANDIDATES = [
  { base: 'https://www.padelshop.com', col: 'palas' },
  { base: 'https://www.padelshop.com', col: 'padel-rackets' },
  { base: 'https://www.padelshop.com', col: 'palas-de-padel' },
  { base: 'https://padelshop.com',     col: 'palas' },
  { base: 'https://padelshop.es',      col: 'palas' },
]

async function tryShopify() {
  for (const { base, col } of CANDIDATES) {
    try {
      const res = await fetch(`${base}/collections/${col}/products.json?limit=${LIMIT}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        redirect: 'follow',
      })
      if (!res.ok) continue
      if (!(res.headers.get('content-type') ?? '').includes('json')) continue
      const data = await res.json()
      if (data.products?.length > 0) return { base, col, products: data.products }
    } catch { continue }
  }
  return null
}

async function scrape() {
  console.log('[padelshop] Iniciando scraper…')
  const seen = new Set()
  const allProducts = []
  const shopifyRes = await tryShopify()

  if (shopifyRes) {
    const { base, col } = shopifyRes
    let products = shopifyRes.products
    let page = 1
    while (products.length === LIMIT) {
      page++
      const res = await fetch(`${base}/collections/${col}/products.json?limit=${LIMIT}&page=${page}`, { headers: { 'Accept': 'application/json' } })
      if (!res.ok) break
      const data = await res.json()
      if (!data.products?.length) break
      products = [...products, ...data.products]
      await sleep(DELAY_MS)
    }
    console.log(`[padelshop] Shopify: ${products.length} productos`)
    for (const p of products) {
      if (!isPala(p.title)) continue
      const variant = p.variants?.[0]
      if (!variant) continue
      const price = parseFloat(variant.price)
      const compare = parseFloat(variant.compare_at_price)
      const pUrl = `${base}/products/${p.handle}`
      if (isNaN(price) || price < 30 || seen.has(pUrl)) continue
      seen.add(pUrl)
      allProducts.push({ title: p.title, price, precio_original: (!isNaN(compare) && compare > price) ? compare : null, url: pUrl })
    }
  } else {
    console.log('[padelshop] ⚠️  No se pudo detectar plataforma — revisar manualmente padelshop.com')
  }

  console.log(`[padelshop] Total palas: ${allProducts.length}`)
  const scraped_at = new Date().toISOString()
  return allProducts.map(p => ({ source_key: SOURCE_KEY, title: p.title, price: p.price, precio_original: p.precio_original ?? null, url: p.url, scraped_at }))
}

module.exports = { scrape, SOURCE_KEY }
