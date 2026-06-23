// scripts/prices/scrapers/justpadel.js
// Just Padel — Shopify JSON API
// NOTA (fix 2026-06-18): la tienda se ha re-orientado a mercado NL (Marketmix B.V.),
// la colección "palas-de-padel" ya no existe/está vacía. Usamos /products.json en
// la raíz (sin colección) y filtramos por product_type === "Rackets", que es el
// campo que Shopify devuelve para las palas/raquetas en este catálogo.
// Paginación: ?limit=250&page=N

const SOURCE_KEY = 'justpadel'
const BASE_URL   = 'https://justpadel.com'
const LIMIT      = 250
const DELAY_MS   = 600

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla', 'pack ',
  'bal', 'tas', 'schoen', 'cap', 'kleding']

function isPala(p) {
  if (p.product_type && p.product_type.toLowerCase() !== 'rackets') return false
  const t = p.title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function scrape() {
  console.log('[justpadel] Iniciando scraper (Shopify JSON API)…')

  const allProducts = []
  const seen = new Set()
  let page = 1

  while (true) {
    const url = `${BASE_URL}/products.json?limit=${LIMIT}&page=${page}`
    console.log(`[justpadel] Página ${page}: ${url}`)

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'application/json',
      },
    })

    if (!res.ok) { console.error(`[justpadel] HTTP ${res.status}`); break }

    const data = await res.json()
    const products = data.products ?? []

    console.log(`[justpadel]  → ${products.length} productos (todas categorías)`)
    if (products.length === 0) break

    for (const p of products) {
      if (!isPala(p)) continue
      const variant  = p.variants?.[0]
      if (!variant) continue
      const price    = parseFloat(variant.price)
      const compare  = parseFloat(variant.compare_at_price)
      const pUrl     = `${BASE_URL}/products/${p.handle}`
      if (isNaN(price) || price < 30 || seen.has(pUrl)) continue
      seen.add(pUrl)

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

  console.log(`[justpadel] Total palas: ${allProducts.length}`)
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
