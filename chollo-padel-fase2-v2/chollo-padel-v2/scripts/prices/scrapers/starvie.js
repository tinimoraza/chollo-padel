// scripts/prices/scrapers/starvie.js
// StarVie tienda oficial — Shopify JSON API
// Plataforma: Shopify (confirmado vía /collections/palas/products.json)
// Solo PVP oficial — útil como precio techo para calcular descuentos reales
//
// Ejecutar:
//   node scripts/prices/pipeline.js starvie

const SOURCE_KEY = 'starvie'
const BASE_URL   = 'https://starvie.com'
const LIMIT      = 250
const DELAY_MS   = 600

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'textil', 'camiseta', 'zapatilla']

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

async function scrape() {
  console.log('[starvie] Iniciando scraper (Shopify JSON API)…')

  const allProducts = []
  const seen = new Set()
  let page = 1

  while (true) {
    const url = `${BASE_URL}/collections/palas/products.json?limit=${LIMIT}&page=${page}`
    console.log(`[starvie] Página ${page}: ${url}`)

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    })

    if (!res.ok) { console.error(`[starvie] HTTP ${res.status}`); break }

    const data = await res.json()
    const products = data.products ?? []

    console.log(`[starvie]  → ${products.length} productos`)
    if (products.length === 0) break

    for (const p of products) {
      if (!isPala(p.title)) continue
      const variant = p.variants?.[0]
      if (!variant) continue

      const price   = parseFloat(variant.price)
      const compare = parseFloat(variant.compare_at_price)
      const url     = `${BASE_URL}/products/${p.handle}`

      if (isNaN(price) || price < 30 || seen.has(url)) continue
      seen.add(url)

      // La tienda oficial omite el nombre de marca — lo añadimos para que el matcher lo detecte
      const title = p.title.toLowerCase().startsWith('starvie') ? p.title : `StarVie ${p.title}`
      allProducts.push({
        title,
        price,
        precio_original: (!isNaN(compare) && compare > price) ? compare : null,
        url,
      })
    }

    if (products.length < LIMIT) break
    page++
    await sleep(DELAY_MS)
  }

  console.log(`[starvie] Total palas: ${allProducts.length}`)
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
