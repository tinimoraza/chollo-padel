// scripts/prices/scrapers/starvie.js
// StarVie tienda oficial — Shopify JSON API
// Plataforma: Shopify (confirmado vía /collections/palas/products.json)
// Solo PVP oficial — útil como precio techo para calcular descuentos reales
//
// Ejecutar:
//   node scripts/prices/pipeline.js starvie

const { refreshShopifyPrices } = require('./_shopify-utils')
const { detectarRebajasYCodigoViaHtml } = require('./_discount-utils.js')

const SOURCE_KEY = 'starvie'
const BASE_URL   = 'https://starvie.com'
const LIMIT      = 250
const DELAY_MS   = 600

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'textil', 'camiseta', 'zapatilla']

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

async function scrape() {
  console.log('[starvie] Iniciando scraper (Shopify JSON API)…')

  const allProducts = []
  const seen = new Set()
  let page = 1

  while (true) {
    const url = `${BASE_URL}/collections/palas/products.json?limit=${LIMIT}&page=${page}`
    console.log(`[starvie] Página ${page}: ${url}`)

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    })

    if (!res.ok) { console.error(`[starvie] HTTP ${res.status}`); break }

    const data = await res.json()
    const products = data.products ?? []

    console.log(`[starvie]  → ${products.length} productos`)
    if (products.length === 0) break

    for (const p of products) {
      if (!isPala(p.title)) continue
      const variant = p.variants?.[0]
      if (!variant) continue

      const price   = parseFloat(variant.price)
      const compare = parseFloat(variant.compare_at_price)
      const url     = `${BASE_URL}/products/${p.handle}`

      if (isNaN(price) || price < 30 || seen.has(url)) continue
      seen.add(url)

      // La tienda oficial omite el nombre de marca — lo añadimos para que el matcher lo detecte
      const title = p.title.toLowerCase().startsWith('starvie') ? p.title : `StarVie ${p.title}`
      const image = p.images?.[0]?.src ?? null
      allProducts.push({
        title,
        price,
        precio_original: (!isNaN(compare) && compare > price) ? compare : null,
        url,
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

  // Tienda Shopify JSON-only: petición HTML extra de solo lectura a la
  // colección, exclusivamente para código de descuento / rebajas.
  const { codigoDescuento, rebajasUrls } = await detectarRebajasYCodigoViaHtml(
    `${BASE_URL}/collections/palas`, BASE_URL
  )
  if (codigoDescuento) {
    console.log(`[starvie] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
  }
  if (rebajasUrls.length > 0) {
    console.log(`[starvie] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
  }
  for (const rebajasUrl of rebajasUrls) {
    const slugMatch = rebajasUrl.match(/\/collections\/([^/?#]+)/)
    if (!slugMatch) continue
    try {
      const res = await fetch(`${BASE_URL}/collections/${slugMatch[1]}/products.json?limit=${LIMIT}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' },
      })
      if (!res.ok) { console.error(`[starvie] sección rebajas ${rebajasUrl} HTTP ${res.status}`); continue }
      const data = await res.json()
      let added = 0
      for (const p of data.products ?? []) {
        if (!isPala(p.title)) continue
        const variant = p.variants?.[0]
        if (!variant) continue
        const price   = parseFloat(variant.price)
        const compare = parseFloat(variant.compare_at_price)
        const url     = `${BASE_URL}/products/${p.handle}`
        if (isNaN(price) || price < 30 || seen.has(url)) continue
        seen.add(url)
        const title = p.title.toLowerCase().startsWith('starvie') ? p.title : `StarVie ${p.title}`
        allProducts.push({
          title,
          price,
          precio_original: (!isNaN(compare) && compare > price) ? compare : null,
          url,
          image: p.images?.[0]?.src ?? null,
          sku: variant.sku || null,
        })
        added++
      }
      console.log(`[starvie] sección rebajas ${rebajasUrl} → ${added} productos nuevos`)
    } catch (e) {
      console.error(`[starvie] Error sección rebajas ${rebajasUrl}:`, e.message)
    }
    await sleep(DELAY_MS)
  }

  console.log(`[starvie] Total palas: ${allProducts.length}`)
  console.log('[starvie] Verificando precios contra ficha individual (el listado puede ir cacheado)…')
  await refreshShopifyPrices(allProducts)
  const scraped_at = new Date().toISOString()
  const resultado = allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    image:           p.image ?? null,
    sku:             p.sku ?? null,
    scraped_at,
  }))
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
