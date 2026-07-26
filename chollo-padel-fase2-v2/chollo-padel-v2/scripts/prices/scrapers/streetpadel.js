// scripts/prices/scrapers/streetpadel.js
// Shopify JSON API — /collections/all con filtro client-side por product_type='Palas'
//
// Nota: streetpadel.com migró de osCommerce a Shopify (detectado 2026-07-26).
// La API products.json ignora el param ?product_type= a nivel de servidor, por lo
// que se pagina toda la colección /all y se filtra en cliente. Confirmado que el
// campo product_type usa el valor "Palas" (mismo que el filtro del storefront).
// El catálogo total es ~3.000+ productos; las palas son ~667 según filtros de la web.

const SOURCE_KEY = 'streetpadel'
const SITE_URL   = 'https://www.streetpadel.com'
const BASE_URL   = 'https://www.streetpadel.com/collections/all/products.json'
const LIMIT      = 250
const DELAY_MS   = 600

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function scrape() {
  console.log('[streetpadel] Iniciando scraper (Shopify JSON API — migración osCommerce→Shopify)…')

  const { detectarRebajasYCodigoViaHtml } = require('./_discount-utils.js')

  const allProducts = []
  const seen = new Set()
  let page = 1

  while (true) {
    const url = `${BASE_URL}?limit=${LIMIT}&page=${page}`
    console.log(`[streetpadel] Página ${page}: ${url}`)

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'application/json',
      },
    })

    if (!res.ok) { console.error(`[streetpadel] HTTP ${res.status}`); break }

    const data = await res.json()
    const products = data.products ?? []

    if (products.length === 0) break

    let palasEnPagina = 0
    for (const p of products) {
      // Solo palas de pádel — filtro client-side por el product_type del storefront
      if (p.product_type !== 'Palas') continue

      // Variante disponible con menor precio; si ninguna disponible, la primera
      const variant = p.variants?.find(v => v.available) ?? p.variants?.[0]
      if (!variant) continue

      const price      = parseFloat(variant.price)
      const compare    = parseFloat(variant.compare_at_price)
      const productUrl = `${SITE_URL}/products/${p.handle}`
      if (isNaN(price) || price < 30 || seen.has(productUrl)) continue
      seen.add(productUrl)

      let image = p.image?.src ?? p.images?.[0]?.src ?? null
      if (image && image.startsWith('//')) image = `https:${image}`

      allProducts.push({
        title:           p.title,
        price,
        precio_original: (!isNaN(compare) && compare > price) ? compare : null,
        url:             productUrl,
        image,
        sku:             variant.sku || null,
      })
      palasEnPagina++
    }

    console.log(`[streetpadel]  → ${products.length} totales en página, ${palasEnPagina} palas (acumulado: ${allProducts.length})`)

    if (products.length < LIMIT) break
    page++
    await sleep(DELAY_MS)
  }

  // Tienda Shopify: petición HTML extra para detectar código descuento y secciones rebajas
  const { codigoDescuento, rebajasUrls } = await detectarRebajasYCodigoViaHtml(
    `${SITE_URL}/collections/all`, SITE_URL
  )
  if (codigoDescuento) {
    console.log(`[streetpadel] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
  }
  if (rebajasUrls.length > 0) {
    console.log(`[streetpadel] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
  }
  for (const rebajasUrl of rebajasUrls) {
    const slugMatch = rebajasUrl.match(/\/collections\/([^/?#]+)/)
    if (!slugMatch) continue
    try {
      const res = await fetch(`${SITE_URL}/collections/${slugMatch[1]}/products.json?limit=${LIMIT}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept':     'application/json',
        },
      })
      if (!res.ok) { console.error(`[streetpadel] sección rebajas ${rebajasUrl} HTTP ${res.status}`); continue }
      const data = await res.json()
      let added = 0
      for (const p of data.products ?? []) {
        if (p.product_type !== 'Palas') continue
        const variant    = p.variants?.find(v => v.available) ?? p.variants?.[0]
        if (!variant) continue
        const price      = parseFloat(variant.price)
        const compare    = parseFloat(variant.compare_at_price)
        const productUrl = `${SITE_URL}/products/${p.handle}`
        if (isNaN(price) || price < 30 || seen.has(productUrl)) continue
        seen.add(productUrl)
        let image = p.image?.src ?? p.images?.[0]?.src ?? null
        if (image && image.startsWith('//')) image = `https:${image}`
        allProducts.push({
          title:           p.title,
          price,
          precio_original: (!isNaN(compare) && compare > price) ? compare : null,
          url:             productUrl,
          image,
          sku:             variant.sku || null,
        })
        added++
      }
      console.log(`[streetpadel] sección rebajas ${rebajasUrl} → ${added} productos nuevos`)
    } catch (e) {
      console.error(`[streetpadel] Error sección rebajas ${rebajasUrl}:`, e.message)
    }
    await sleep(DELAY_MS)
  }

  console.log(`[streetpadel] Total palas únicas: ${allProducts.length}`)
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
