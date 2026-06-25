// scripts/prices/scrapers/futurapadelshop.js
// Futura Padel Shop — Shopify JSON API
// URL colección: https://futurapadelshop.com/collections/palas
// Paginación: ?limit=250&page=N

// NOTA: No usamos refreshShopifyPrices de _shopify-utils porque desde
// GitHub Actions la CDN de Shopify sirve respuestas cacheadas incluso con
// Cache-Control: no-cache (Node.js ignora la opción `cache: 'no-store'` del
// fetch nativo — es una opción de browser API, no de Node). Fix local:
// función inline que añade ?fields=id,variants,title&_=timestamp a la URL
// de ficha individual, lo que fuerza una cache key única en la CDN.
// _shopify-utils.js no se toca → resto de tiendas sin riesgo.

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

async function refreshFuturaPrices(products, delayMs = 1500) {
  let corregidos = 0
  let fallidos   = 0

  for (const p of products) {
    try {
      // ?fields= fuerza cache key única en la CDN de Shopify.
      // ?_= añade timestamp como segunda barrera anti-caché.
      const bustUrl = `${p.url}.json?fields=id,variants,title&_=${Date.now()}`
      const res = await fetch(bustUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept':     'application/json',
          'Cache-Control': 'no-cache',
          'Pragma':        'no-cache',
        },
      })

      if (res.ok) {
        const data    = await res.json()
        const variant = data.product?.variants?.[0]
        if (variant) {
          const freshPrice   = parseFloat(variant.price)
          const freshCompare = parseFloat(variant.compare_at_price)
          if (!isNaN(freshPrice) && freshPrice >= 30) {
            if (freshPrice !== p.price) {
              console.log(`  [refresh] ${p.url} → listado=${p.price} ficha=${freshPrice}`)
              corregidos++
            }
            p.price           = freshPrice
            p.precio_original = (!isNaN(freshCompare) && freshCompare > freshPrice) ? freshCompare : null
          }
          if (typeof variant.available === 'boolean') {
            p.disponible = variant.available
          } else if (typeof data.product?.available === 'boolean') {
            p.disponible = data.product.available
          }
        }
      } else {
        console.warn(`  [refresh] HTTP ${res.status} → ${p.url}`)
        fallidos++
      }
    } catch (err) {
      console.warn(`  [refresh] ERROR → ${p.url}: ${err.message}`)
      fallidos++
    }

    await sleep(delayMs)
  }

  console.log(`  → refreshFuturaPrices: ${corregidos} precios corregidos vs listado, ${fallidos} fichas no accesibles (de ${products.length})`)
  return products
}

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

    const data     = await res.json()
    const products = data.products ?? []

    console.log(`[futurapadelshop]  → ${products.length} productos`)
    if (products.length === 0) break

    for (const p of products) {
      if (!isPala(p.title)) continue
      const variant = p.variants?.[0]
      if (!variant) continue
      const price   = parseFloat(variant.price)
      const compare = parseFloat(variant.compare_at_price)
      const pUrl    = `${BASE_URL}/products/${p.handle}`
      if (isNaN(price) || price < 30 || seen.has(pUrl)) continue
      seen.add(pUrl)

      const image = p.images?.[0]?.src?.split('?')[0] ?? null

      allProducts.push({
        title:           p.title,
        price,
        precio_original: (!isNaN(compare) && compare > price) ? compare : null,
        url:             pUrl,
        image,
        sku:             variant.sku || null,
        disponible:      typeof variant.available === 'boolean' ? variant.available : true,
      })
    }

    if (products.length < LIMIT) break
    page++
    await sleep(DELAY_MS)
  }

  console.log(`[futurapadelshop] Total palas: ${allProducts.length}`)
  console.log('[futurapadelshop] Verificando precios contra ficha individual (anti-caché CDN)…')
  await refreshFuturaPrices(allProducts)

  const scraped_at = new Date().toISOString()
  return allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    image:           p.image ?? null,
    sku:             p.sku ?? null,
    disponible:      p.disponible ?? true,
    scraped_at,
  }))
}

module.exports = { scrape, SOURCE_KEY }
