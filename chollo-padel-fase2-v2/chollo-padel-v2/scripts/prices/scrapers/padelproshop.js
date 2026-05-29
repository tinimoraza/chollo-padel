// scripts/prices/scrapers/padelproshop.js
// v3 (2026-05-29): API JSON de Shopify en vez de Playwright
// Shopify expone /collections/{handle}/products.json?limit=250&page=N
// No requiere navegador — mucho más rápido y fiable.

const SOURCE_KEY = 'padelproshop'
const BASE_URL   = 'https://padelproshop.com/collections/palas-padel/products.json'
const LIMIT      = 250
const DELAY_MS   = 800

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function scrape() {
  console.log('[padelproshop] Iniciando scraper (Shopify JSON API)…')

  const allProducts = []
  const seen = new Set()
  let page = 1

  while (true) {
    const url = `${BASE_URL}?limit=${LIMIT}&page=${page}`
    console.log(`[padelproshop] Página ${page}: ${url}`)

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HuntPadel/1.0)',
        'Accept':     'application/json',
      },
    })

    if (!res.ok) {
      console.error(`[padelproshop] Error HTTP ${res.status} en página ${page}`)
      break
    }

    const data = await res.json()
    const products = data.products ?? []

    if (products.length === 0) {
      console.log(`[padelproshop] Página ${page} vacía — fin`)
      break
    }

    console.log(`[padelproshop]  → ${products.length} productos`)

    for (const p of products) {
      const variant = p.variants?.[0]
      if (!variant) continue

      const price    = parseFloat(variant.price)
      const compare  = parseFloat(variant.compare_at_price)
      const url      = `https://padelproshop.com/products/${p.handle}`

      if (!p.title || isNaN(price) || price <= 0) continue
      if (seen.has(url)) continue
      seen.add(url)

      allProducts.push({
        title:           p.title,
        price,
        precio_original: (!isNaN(compare) && compare > price) ? compare : null,
        url,
      })
    }

    if (products.length < LIMIT) {
      console.log(`[padelproshop] Última página (${page}). Total: ${allProducts.length}`)
      break
    }

    page++
    await sleep(DELAY_MS)
  }

  console.log(`[padelproshop] Total palas únicas: ${allProducts.length}`)

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
