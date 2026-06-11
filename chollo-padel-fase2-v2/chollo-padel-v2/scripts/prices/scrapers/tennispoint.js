// scripts/prices/scrapers/tennispoint.js
// v2 (2026-05-29): Shopify JSON API — filtra product_type='Padel rackets'
// Tennis-Point migró a Shopify, URL antigua /padel/palas-de-padel/ da 404

const SOURCE_KEY = 'tennispoint'
const BASE_URL   = 'https://www.tennis-point.es/collections/padel/products.json'
const LIMIT      = 250
const DELAY_MS   = 600

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function scrape() {
  console.log('[tennispoint] Iniciando scraper (Shopify JSON API)…')

  const allProducts = []
  const seen = new Set()
  let page = 1

  while (true) {
    const url = `${BASE_URL}?limit=${LIMIT}&page=${page}`
    console.log(`[tennispoint] Página ${page}: ${url}`)

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'application/json',
      },
    })

    if (!res.ok) { console.error(`[tennispoint] HTTP ${res.status}`); break }

    const data = await res.json()
    const products = (data.products ?? []).filter(p => p.product_type === 'Padel rackets')

    console.log(`[tennispoint]  → ${products.length} palas`)
    if (products.length === 0) break

    for (const p of products) {
      const variant  = p.variants?.[0]
      if (!variant) continue
      const price    = parseFloat(variant.price)
      const compare  = parseFloat(variant.compare_at_price)
      const url      = `https://www.tennis-point.es/products/${p.handle}`
      if (isNaN(price) || price < 30 || seen.has(url)) continue
      // Excluir palas de test (precio ~15€, titulo con "test")
      if (/\btest\b/i.test(p.title)) continue
      seen.add(url)
      // Shopify devuelve p.vendor con la marca (ej: "Wilson", "Bullpadel")
      // Los títulos de Tennis-Point no incluyen la marca, lo añadimos aquí
      // Limpiar sufijos de pack: "Más raquetera", "Más tubo de pelotas", etc.
      const cleanTitle = p.title
        .replace(/\s*[+|]\s*Más\s+[^|+]+/gi, '')
        .replace(/\s*Más\s+(raquetera|tubo de pelotas|bolsa|mochila|funda|paletero)[^,]*/gi, '')
        .replace(/\s*,\s*Más\s+(raquetera|tubo de pelotas|bolsa|mochila|funda|paletero)[^,]*/gi, '')
        .replace(/\s*Pala de pádel\s*$/i, '')
        .replace(/\s*Pala de padel\s*$/i, '')
        .trim()
      const title = p.vendor ? `${p.vendor} ${cleanTitle}` : cleanTitle
      allProducts.push({
        title,
        price,
        precio_original: (!isNaN(compare) && compare > price) ? compare : null,
        url,
      })
    }

    if ((data.products ?? []).length < LIMIT) break
    page++
    await sleep(DELAY_MS)
  }

  console.log(`[tennispoint] Total palas: ${allProducts.length}`)
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
