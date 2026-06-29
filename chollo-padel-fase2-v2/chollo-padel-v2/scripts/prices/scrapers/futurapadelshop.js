// scripts/prices/scrapers/futurapadelshop.js
// Futura Padel Shop — Shopify JSON API
// URL colección: https://futurapadelshop.com/collections/palas
// Paginación: ?limit=250&page=N

// NOTA IVA: Futura Padel Shop tiene mercados internacionales activos en Shopify.
// Desde IPs de datacenter (GitHub Actions) el JSON API devuelve precios sin IVA (ex-VAT).
// Confirmado: 102.48 × 1.21 = 123.99 ≈ 124€ (precio real con IVA 21%).
// Fix: multiplicar precio y compare_at_price × 1.21 y redondear a 2 decimales.
// El resto de tiendas Shopify del proyecto no tienen este problema (verificado).

const SOURCE_KEY = 'futurapadelshop'
const BASE_URL   = 'https://futurapadelshop.com'
const COLLECTION = 'palas'
const LIMIT      = 250
const DELAY_MS   = 600
const IVA        = 1.21

const { detectarRebajasYCodigoViaHtml } = require('./_discount-utils.js')

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla', 'pack ']

function isPala(title) {
  return !EXCLUIR.some(w => title.toLowerCase().includes(w))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function conIVA(price) {
  return Math.round(price * IVA * 100) / 100
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
      const priceRaw   = parseFloat(variant.price)
      const compareRaw = parseFloat(variant.compare_at_price)
      const pUrl       = `${BASE_URL}/products/${p.handle}`
      if (isNaN(priceRaw) || priceRaw < 30 || seen.has(pUrl)) continue
      seen.add(pUrl)

      const price   = conIVA(priceRaw)
      const compare = (!isNaN(compareRaw) && compareRaw > priceRaw) ? conIVA(compareRaw) : null
      const image   = p.images?.[0]?.src?.split('?')[0] ?? null

      allProducts.push({
        title:           p.title,
        price,
        precio_original: compare,
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

  // Estas tiendas (Shopify JSON API) no descargan HTML normalmente — petición
  // extra de solo lectura a la página de colección para detectar banners de
  // código de descuento y enlaces a secciones de rebajas no contempladas.
  const { codigoDescuento, rebajasUrls } = await detectarRebajasYCodigoViaHtml(
    `${BASE_URL}/collections/${COLLECTION}`, BASE_URL
  )
  if (codigoDescuento) {
    console.log(`[futurapadelshop] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
  }
  if (rebajasUrls.length > 0) {
    console.log(`[futurapadelshop] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
  }
  for (const rebajasUrl of rebajasUrls) {
    const slugMatch = rebajasUrl.match(/\/collections\/([^/?#]+)/)
    if (!slugMatch) continue
    try {
      const res = await fetch(`${BASE_URL}/collections/${slugMatch[1]}/products.json?limit=${LIMIT}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' },
      })
      if (!res.ok) { console.error(`[futurapadelshop] sección rebajas ${rebajasUrl} HTTP ${res.status}`); continue }
      const data = await res.json()
      let added = 0
      for (const p of data.products ?? []) {
        if (!isPala(p.title)) continue
        const variant = p.variants?.[0]
        if (!variant) continue
        const priceRaw = parseFloat(variant.price)
        const compareRaw = parseFloat(variant.compare_at_price)
        const pUrl = `${BASE_URL}/products/${p.handle}`
        if (isNaN(priceRaw) || priceRaw < 30 || seen.has(pUrl)) continue
        seen.add(pUrl)
        allProducts.push({
          title: p.title,
          price: conIVA(priceRaw),
          precio_original: (!isNaN(compareRaw) && compareRaw > priceRaw) ? conIVA(compareRaw) : null,
          url: pUrl,
          image: p.images?.[0]?.src?.split('?')[0] ?? null,
          sku: variant.sku || null,
          disponible: typeof variant.available === 'boolean' ? variant.available : true,
        })
        added++
      }
      console.log(`[futurapadelshop] sección rebajas ${rebajasUrl} → ${added} productos nuevos`)
    } catch (e) {
      console.error(`[futurapadelshop] Error sección rebajas ${rebajasUrl}:`, e.message)
    }
    await sleep(DELAY_MS)
  }

  console.log(`[futurapadelshop] Total palas: ${allProducts.length}`)

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
