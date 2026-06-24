// scripts/prices/scrapers/futurapadelshop.js
// Futura Padel Shop — Shopify JSON API
// URL colección: https://futurapadelshop.com/collections/palas
// Paginación: ?limit=250&page=N

const { refreshShopifyPrices } = require('./_shopify-utils')

const SOURCE_KEY = 'futurapadelshop'
const BASE_URL   = 'https://futurapadelshop.com'
const COLLECTION = 'palas'
const LIMIT      = 250
const DELAY_MS   = 600

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla', 'pack ']

function isPala(title) {
  return !EXCLUIR.some(w => title.toLowerCase().includes(w))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function scrape() {
  console.log('[futurapadelshop] Iniciando scraper (Shopify JSON API)…')

  const allProducts = []
  const seen = new Set()
  let page = 1

  while (true) {
    const url = `${BASE_URL}/collections/${COLLECTION}/products.json?limit=${LIMIT}&page=${page}`
    console.log(`[futurapadelshop] Página ${page}: ${url}`)

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'application/json',
      },
    })

    if (!res.ok) { console.error(`[futurapadelshop] HTTP ${res.status}`); break }

    const data = await res.json()
    const products = data.products ?? []

    console.log(`[futurapadelshop]  → ${products.length} productos`)
    if (products.length === 0) break

    for (const p of products) {
      if (!isPala(p.title)) continue
      const variant  = p.variants?.[0]
      if (!variant) continue
      const price    = parseFloat(variant.price)
      const compare  = parseFloat(variant.compare_at_price)
      const pUrl     = `${BASE_URL}/products/${p.handle}`
      if (isNaN(price) || price < 30 || seen.has(pUrl)) continue
      seen.add(pUrl)

      // Imagen principal
      const image = p.images?.[0]?.src?.split('?')[0] ?? null

      allProducts.push({
        title:           p.title,
        price,
        precio_original: (!isNaN(compare) && compare > price) ? compare : null,
        url:             pUrl,
        image,
        // Piloto coste-beneficio 2026-06-23: Shopify ya incluye "sku" por
        // variante en el mismo JSON, sin petición extra. Se guarda sin tocar
        // el matching/extracción existente — solo para comparar empíricamente
        // si coincide con el de otras tiendas antes de usarlo en el matching real.
        sku: variant.sku || null,
      })
    }

    if (products.length < LIMIT) break
    page++
    await sleep(DELAY_MS)
  }

  console.log(`[futurapadelshop] Total palas: ${allProducts.length}`)
  console.log('[futurapadelshop] Verificando precios contra ficha individual (el listado puede ir cacheado)…')
  await refreshShopifyPrices(allProducts)
  const scraped_at = new Date().toISOString()
  return allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    image:           p.image ?? null,
    sku:             p.sku ?? null,
    scraped_at,
  }))
}

module.exports = { scrape, SOURCE_KEY }
