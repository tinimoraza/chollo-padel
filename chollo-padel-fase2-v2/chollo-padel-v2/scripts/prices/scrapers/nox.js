// scripts/prices/scrapers/nox.js
// NOX tienda oficial — Shopify JSON API (probable) con fallback HTML
// URL: https://www.nox.es
// NOTA: PVP oficial NOX
//
// Ejecutar:
//   node scripts/prices/pipeline.js nox

const SOURCE_KEY = 'nox'
const DELAY_MS   = 700
const LIMIT      = 250

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla', 'bota']

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

const CANDIDATES = [
  { base: 'https://www.nox.es', col: 'palas' },
  { base: 'https://www.nox.es', col: 'palas-de-padel' },
  { base: 'https://nox.es',     col: 'palas' },
  { base: 'https://nox.es',     col: 'palas-de-padel' },
]

async function tryShopify() {
  for (const { base, col } of CANDIDATES) {
    const url = `${base}/collections/${col}/products.json?limit=${LIMIT}`
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      })
      if (!res.ok) continue
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('json')) continue
      const data = await res.json()
      if (data.products?.length > 0) {
        return { base, col, products: data.products }
      }
    } catch { continue }
  }
  return null
}

async function scrape() {
  console.log('[nox] Iniciando scraper…')

  const seen = new Set()
  const allProducts = []

  const shopifyRes = await tryShopify()

  if (shopifyRes) {
    const { base, col } = shopifyRes
    let products = shopifyRes.products
    let page = 1

    while (products.length === LIMIT) {
      page++
      const url = `${base}/collections/${col}/products.json?limit=${LIMIT}&page=${page}`
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
      if (!res.ok) break
      const data = await res.json()
      if (!data.products?.length) break
      products = [...products, ...data.products]
      await sleep(DELAY_MS)
    }

    console.log(`[nox] Shopify: ${products.length} productos totales`)

    for (const p of products) {
      if (!isPala(p.title)) continue
      const variant = p.variants?.[0]
      if (!variant) continue
      const price   = parseFloat(variant.price)
      const compare = parseFloat(variant.compare_at_price)
      const pUrl    = `${base}/products/${p.handle}`
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
    console.log('[nox] ⚠️  Shopify no disponible — revisar plataforma manualmente en nox.es')
  }

  console.log(`[nox] Total palas: ${allProducts.length}`)
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
