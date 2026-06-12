// scripts/prices/scrapers/pdhsports.js
// PDH Sports — tienda multideporte (UK), Shopify
// URL productos: https://pdhsports.com/collections/padel-rackets/products.json
// NOTA: precios en GBP (tienda británica) — tener en cuenta al interpretar price_reference
// Paginación: ?limit=250&page=N (Shopify clásico)

const SOURCE_KEY = 'pdhsports'
const BASE_URL   = 'https://pdhsports.com/collections/padel-rackets/products.json'
const PAGE_SIZE  = 250
const DELAY_MS   = 1000

async function scrape() {
  console.log('[pdhsports] Iniciando scraper (Shopify JSON API)...')

  let fetchFn
  try {
    fetchFn = (await import('node-fetch')).default
  } catch {
    fetchFn = globalThis.fetch
  }

  const allProducts = []
  let page = 1

  try {
    while (true) {
      const url = `${BASE_URL}?limit=${PAGE_SIZE}&page=${page}`
      console.log(`[pdhsports] Pagina ${page}: ${url}`)

      const res = await fetchFn(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept':     'application/json',
        },
      })

      if (!res.ok) {
        console.error(`[pdhsports] HTTP ${res.status} en pagina ${page}`)
        break
      }

      const data = await res.json()
      const products = data.products ?? []
      console.log(`[pdhsports]  -> ${products.length} productos`)

      if (products.length === 0) break

      for (const p of products) {
        const variant = p.variants?.[0]
        if (!variant) continue

        const price = parseFloat(variant.price)
        if (isNaN(price) || price <= 0) continue

        const compareAt = variant.compare_at_price ? parseFloat(variant.compare_at_price) : NaN
        const precioOriginal = (!isNaN(compareAt) && compareAt > price) ? compareAt : null

        const image = p.images?.[0]?.src ?? null

        allProducts.push({
          title:           p.title,
          price,
          precio_original: precioOriginal,
          url:             `https://pdhsports.com/products/${p.handle}`,
          image,
        })
      }

      if (products.length < PAGE_SIZE) {
        console.log(`[pdhsports] Ultima pagina (${page}). Total: ${allProducts.length}`)
        break
      }

      page++
      await new Promise(r => setTimeout(r, DELAY_MS))
    }
  } catch (err) {
    console.error('[pdhsports] Error:', err.message)
  }

  const seen = new Set()
  const unique = allProducts.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[pdhsports] Total palas unicas: ${unique.length}`)

  const scraped_at = new Date().toISOString()
  return unique.map(p => ({
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
