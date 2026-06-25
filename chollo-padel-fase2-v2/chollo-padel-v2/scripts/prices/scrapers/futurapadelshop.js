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

// Fix root-cause 2026-06-25: el JSON de Shopify (listado y ficha individual)
// devuelve variant.price SIN impuestos. El precio que ve el cliente (el que
// queremos guardar) sí los incluye, y Shopify lo deja ya calculado en el HTML
// de la ficha, en la etiqueta <meta property="og:price:amount">. Se lee ese
// valor directamente — sin asumir ningún % de IVA — y se usa para sobrescribir
// el precio del JSON, que puede venir desfasado por este motivo.
async function fetchRenderedPrice(url) {
  try {
    const res = await fetch(`${url}?_=${Date.now()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const html = await res.text()
    const m = html.match(/property=["']og:price:amount["']\s+content=["']([\d.,]+)["']/)
    if (!m) return null
    const normalized = m[1].replace(/\./g, '').replace(',', '.')
    const price = parseFloat(normalized)
    return isNaN(price) ? null : price
  } catch {
    return null
  }
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
        // Fix root-cause 2026-06-24: disponibilidad real de Shopify (antes no
        // se leía y el pipeline guardaba siempre disponible=true). Se
        // sobrescribe con el valor más fresco dentro de refreshShopifyPrices
        // si la ficha individual responde.
        disponible: typeof variant.available === 'boolean' ? variant.available : true,
      })
    }

    if (products.length < LIMIT) break
    page++
    await sleep(DELAY_MS)
  }

  console.log(`[futurapadelshop] Total palas: ${allProducts.length}`)
  console.log('[futurapadelshop] Verificando precios contra ficha individual (el listado puede ir cacheado)…')
  await refreshShopifyPrices(allProducts)

  console.log('[futurapadelshop] Corrigiendo precio final (con impuestos) leído del HTML de cada ficha…')
  let htmlCorregidos = 0, htmlFallidos = 0
  for (const p of allProducts) {
    const renderedPrice = await fetchRenderedPrice(p.url)
    if (renderedPrice !== null) {
      if (renderedPrice !== p.price) htmlCorregidos++
      p.price = renderedPrice
    } else {
      htmlFallidos++
    }
    await sleep(DELAY_MS)
  }
  console.log(`  → fetchRenderedPrice: ${htmlCorregidos} precios corregidos vs JSON, ${htmlFallidos} fichas HTML no accesibles/sin meta tag (de ${allProducts.length})`)

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
