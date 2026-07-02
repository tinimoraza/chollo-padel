// scripts/prices/scrapers/padelisland.js
// padel-island.com — Shopify JSON API
// Tienda en Majadahonda (Madrid), 4.8⭐ / 47 reseñas Trustpilot
// También vende pickleball (colección separada, ignorada aquí)
// URL colección: https://www.padel-island.com/en/collections/palas
// API: https://www.padel-island.com/en/collections/palas/products.json
//
// Precios vienen como decimales con IVA incluido (no céntimos, no ajuste IVA necesario)
// Prefijo de idioma /en/ en todas las URLs de la tienda

const SOURCE_KEY = 'padelisland'
const BASE_URL   = 'https://www.padel-island.com'
const COLLECTION = 'en/collections/palas'
const LIMIT      = 250
const DELAY_MS   = 500

const { detectarRebajasYCodigoViaHtml } = require('./_discount-utils.js')
const { refreshShopifyPrices }          = require('./_shopify-utils.js')

const EXCLUIR = [
  'grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla',
  'pack ', 'pickleball',
]

function esPala(title) {
  const low = title.toLowerCase()
  return !EXCLUIR.some(w => low.includes(w))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function scrape() {
  console.log('[padelisland] Iniciando scraper (Shopify JSON API)…')

  const allProducts = []
  const seen = new Set()
  let page = 1

  while (true) {
    const url = `${BASE_URL}/${COLLECTION}/products.json?limit=${LIMIT}&page=${page}`
    console.log(`[padelisland] Página ${page}: ${url}`)

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':     'application/json',
      },
    })

    if (!res.ok) { console.error(`[padelisland] HTTP ${res.status}`); break }

    const data     = await res.json()
    const products = data.products ?? []

    console.log(`[padelisland]  → ${products.length} productos`)
    if (products.length === 0) break

    for (const p of products) {
      if (!esPala(p.title)) continue
      const variant = p.variants?.[0]
      if (!variant) continue

      const price   = parseFloat(variant.price)
      const compare = parseFloat(variant.compare_at_price)
      // Padel-island sirve precios con IVA directamente (decimal, no céntimos)
      const pUrl    = `${BASE_URL}/en/products/${p.handle}`

      if (isNaN(price) || price < 30 || seen.has(pUrl)) continue
      seen.add(pUrl)

      const precio_original = (!isNaN(compare) && compare > price) ? compare : null
      const image           = p.images?.[0]?.src?.split('?')[0] ?? null

      allProducts.push({
        title:           p.title,
        price,
        precio_original,
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

  // Refresco anti-caché de precios (igual que en el resto de scrapers Shopify)
  if (allProducts.length > 0) {
    await refreshShopifyPrices(allProducts, { delayMs: DELAY_MS })
  }

  // Petición HTML extra para detectar código de descuento y secciones de rebajas
  const { codigoDescuento, rebajasUrls } = await detectarRebajasYCodigoViaHtml(
    `${BASE_URL}/${COLLECTION}`, BASE_URL
  )
  if (codigoDescuento) {
    console.log(`[padelisland] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
  }
  if (rebajasUrls.length > 0) {
    console.log(`[padelisland] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
  }

  // Scrape de secciones de rebajas detectadas (patrón idéntico a futurapadelshop)
  for (const rebajasUrl of rebajasUrls) {
    const slugMatch = rebajasUrl.match(/\/collections\/([^/?#]+)/)
    if (!slugMatch) continue
    try {
      const res = await fetch(`${BASE_URL}/collections/${slugMatch[1]}/products.json?limit=${LIMIT}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
      })
      if (!res.ok) { console.error(`[padelisland] sección rebajas HTTP ${res.status}`); continue }
      const data = await res.json()
      let added = 0
      for (const p of data.products ?? []) {
        if (!esPala(p.title)) continue
        const variant = p.variants?.[0]
        if (!variant) continue
        const price   = parseFloat(variant.price)
        const compare = parseFloat(variant.compare_at_price)
        const pUrl    = `${BASE_URL}/en/products/${p.handle}`
        if (isNaN(price) || price < 30 || seen.has(pUrl)) continue
        seen.add(pUrl)
        allProducts.push({
          title:           p.title,
          price,
          precio_original: (!isNaN(compare) && compare > price) ? compare : null,
          url:             pUrl,
          image:           p.images?.[0]?.src?.split('?')[0] ?? null,
          sku:             variant.sku || null,
          disponible:      typeof variant.available === 'boolean' ? variant.available : true,
        })
        added++
      }
      console.log(`[padelisland] sección rebajas ${rebajasUrl} → ${added} productos nuevos`)
    } catch (e) {
      console.error(`[padelisland] Error sección rebajas ${rebajasUrl}:`, e.message)
    }
    await sleep(DELAY_MS)
  }

  console.log(`[padelisland] Total palas: ${allProducts.length}`)

  const scraped_at = new Date().toISOString()
  const resultado = allProducts.map(p => ({
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
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
