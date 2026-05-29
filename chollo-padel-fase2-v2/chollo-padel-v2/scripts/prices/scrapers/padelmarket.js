// scripts/prices/scrapers/padelmarket.js
// Shopify JSON API — collection "palas"
// ~310 palas en 2 páginas (250 + 60)

const SOURCE_KEY = 'padelmarket'
const BASE_URL   = 'https://padelmarket.com/collections/palas/products.json'
const LIMIT      = 250
const DELAY_MS   = 600

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function scrape() {
  console.log('[padelmarket] Iniciando scraper (Shopify JSON API)…')

  const allProducts = []
  const seen = new Set()
  let page = 1

  while (true) {
    const url = `${BASE_URL}?limit=${LIMIT}&page=${page}`
    console.log(`[padelmarket] Página ${page}: ${url}`)

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'application/json',
      },
    })

    if (!res.ok) { console.error(`[padelmarket] HTTP ${res.status}`); break }

    const data = await res.json()
    const products = data.products ?? []

    console.log(`[padelmarket]  → ${products.length} productos`)
    if (products.length === 0) break

    for (const p of products) {
      const variant = p.variants?.[0]
      if (!variant) continue
      const price   = parseFloat(variant.price)
      const compare = parseFloat(variant.compare_at_price)
      const url     = `https://padelmarket.com/products/${p.handle}`
      if (isNaN(price) || price < 30 || seen.has(url)) continue
      seen.add(url)
      allProducts.push({
        title:           p.title,
        price,
        precio_original: (!isNaN(compare) && compare > price) ? compare : null,
        url,
      })
    }

    if (products.length < LIMIT) break
    page++
    await sleep(DELAY_MS)
  }

  console.log(`[padelmarket] Total palas: ${allProducts.length}`)
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
