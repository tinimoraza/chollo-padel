// scripts/prices/scrapers/tennispoint.js
// v2 (2026-05-29): Shopify JSON API — filtra product_type='Padel rackets'
// Tennis-Point migró a Shopify, URL antigua /padel/palas-de-padel/ da 404

const { refreshShopifyPrices } = require('./_shopify-utils')
const { detectarRebajasYCodigoViaHtml } = require('./_discount-utils.js')

const SOURCE_KEY = 'tennispoint'
const SITE_URL   = 'https://www.tennis-point.es'
const BASE_URL   = 'https://www.tennis-point.es/collections/padel/products.json'
const LIMIT      = 250
const DELAY_MS   = 600

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function limpiarTitulo(p) {
  const cleanTitle = p.title
    .replace(/\s*[+|]\s*Más\s+[^|+]+/gi, '')
    .replace(/\s*Más\s+(raquetera|tubo de pelotas|bolsa|mochila|funda|paletero)[^,]*/gi, '')
    .replace(/\s*,\s*Más\s+(raquetera|tubo de pelotas|bolsa|mochila|funda|paletero)[^,]*/gi, '')
    .replace(/\s*Pala de pádel\s*$/i, '')
    .replace(/\s*Pala de padel\s*$/i, '')
    .replace(/[,;]\s*$/, '')
    .trim()
  return p.vendor ? `${p.vendor} ${cleanTitle}` : cleanTitle
}

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
      const title = limpiarTitulo(p)
      // Shopify devuelve la imagen en p.image.src (o p.images[0].src como fallback)
      const image = p.image?.src ?? p.images?.[0]?.src ?? null
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

    if ((data.products ?? []).length < LIMIT) break
    page++
    await sleep(DELAY_MS)
  }

  // Tienda Shopify JSON-only: petición HTML extra de solo lectura a la
  // colección, exclusivamente para código de descuento / rebajas.
  const { codigoDescuento, rebajasUrls } = await detectarRebajasYCodigoViaHtml(
    `${SITE_URL}/collections/padel`, SITE_URL
  )
  if (codigoDescuento) {
    console.log(`[tennispoint] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
  }
  if (rebajasUrls.length > 0) {
    console.log(`[tennispoint] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
  }
  for (const rebajasUrl of rebajasUrls) {
    const slugMatch = rebajasUrl.match(/\/collections\/([^/?#]+)/)
    if (!slugMatch) continue
    try {
      const res = await fetch(`${SITE_URL}/collections/${slugMatch[1]}/products.json?limit=${LIMIT}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' },
      })
      if (!res.ok) { console.error(`[tennispoint] sección rebajas ${rebajasUrl} HTTP ${res.status}`); continue }
      const data = await res.json()
      let added = 0
      for (const p of (data.products ?? []).filter(p => p.product_type === 'Padel rackets')) {
        const variant = p.variants?.[0]
        if (!variant) continue
        const price   = parseFloat(variant.price)
        const compare = parseFloat(variant.compare_at_price)
        const url     = `${SITE_URL}/products/${p.handle}`
        if (isNaN(price) || price < 30 || seen.has(url)) continue
        if (/\btest\b/i.test(p.title)) continue
        seen.add(url)
        allProducts.push({
          title: limpiarTitulo(p),
          price,
          precio_original: (!isNaN(compare) && compare > price) ? compare : null,
          url,
          image: p.image?.src ?? p.images?.[0]?.src ?? null,
          sku: variant.sku || null,
        })
        added++
      }
      console.log(`[tennispoint] sección rebajas ${rebajasUrl} → ${added} productos nuevos`)
    } catch (e) {
      console.error(`[tennispoint] Error sección rebajas ${rebajasUrl}:`, e.message)
    }
    await sleep(DELAY_MS)
  }

  console.log(`[tennispoint] Total palas: ${allProducts.length}`)
  console.log('[tennispoint] Verificando precios contra ficha individual (el listado puede ir cacheado)…')
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
