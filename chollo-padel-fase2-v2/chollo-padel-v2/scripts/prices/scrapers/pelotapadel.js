// scripts/prices/scrapers/pelotapadel.js
// pelotapadel.com — WooCommerce Store API pública (wc/store/v1)
// Activa desde 2010, 4.7⭐ / 1.279 reseñas Trustpilot (mayor volumen de la categoría)
// URL categoría: https://pelotapadel.com/categoria/palas-de-padel/
// API: https://pelotapadel.com/wp-json/wc/store/v1/products?category=palas-de-padel
//
// Precios vienen como céntimos enteros (sale_price/regular_price, minor_unit=2)
// ej. "14995" = 149,95€

const { detectarRebajasYCodigoViaHtml } = require('./_discount-utils.js')

const SOURCE_KEY = 'pelotapadel'
const BASE_URL   = 'https://pelotapadel.com'
const CATEGORY   = 'palas-de-padel'
const PER_PAGE   = 100
const DELAY_MS   = 500

// Pelotapadel mezcla packs con accesorios en la categoría de palas.
// Se filtran por prefijo de título para no incluir bundles que inflarían precios.
const EXCLUIR = [
  'pack ', 'grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla',
]

function esPala(name) {
  const low = name.toLowerCase()
  return !EXCLUIR.some(w => low.startsWith(w) || low.includes(' ' + w))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function centsToEuros(centsStr, minorUnit) {
  if (centsStr == null || centsStr === '') return NaN
  const n = parseInt(centsStr, 10)
  if (isNaN(n)) return NaN
  return n / Math.pow(10, minorUnit || 2)
}

function bestImage(images) {
  if (!Array.isArray(images) || images.length === 0) return null
  return images[0].src || images[0].thumbnail || null
}

async function fetchPage(page) {
  const url = `${BASE_URL}/wp-json/wc/store/v1/products?category=${CATEGORY}&per_page=${PER_PAGE}&page=${page}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const totalPages = parseInt(res.headers.get('x-wp-totalpages') || '1', 10)
  const data = await res.json()
  return { data, totalPages }
}

async function scrape() {
  console.log('[pelotapadel] Iniciando scraper (WooCommerce Store API)…')

  const allProducts = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    let result
    try {
      result = await fetchPage(page)
    } catch (e) {
      console.error(`[pelotapadel] Error página ${page}:`, e.message)
      break
    }

    const { data, totalPages: tp } = result
    totalPages = tp
    if (!Array.isArray(data) || data.length === 0) break

    for (const p of data) {
      const title = p.name
      const url   = p.permalink
      if (!title || !url) continue
      if (!esPala(title)) continue

      const minorUnit    = p.prices?.currency_minor_unit ?? 2
      const salePrice    = centsToEuros(p.prices?.sale_price, minorUnit)
      const regularPrice = centsToEuros(p.prices?.regular_price, minorUnit)

      const price = !isNaN(salePrice) && salePrice > 0 ? salePrice : regularPrice
      if (isNaN(price) || price < 30) continue

      const precio_original = (!isNaN(regularPrice) && regularPrice > price) ? regularPrice : null

      allProducts.push({
        title,
        price,
        precio_original,
        url,
        image: bestImage(p.images),
        sku:   p.sku || null,
      })
    }

    console.log(`[pelotapadel] página ${page}/${totalPages} → ${data.length} productos`)

    page++
    if (page <= totalPages) await sleep(DELAY_MS)
  }

  console.log(`[pelotapadel] Total palas: ${allProducts.length}`)

  // Petición HTML extra de solo lectura a la home para detectar código de
  // descuento y enlaces a secciones de rebajas no cubiertas por la categoría.
  const { codigoDescuento, rebajasUrls } = await detectarRebajasYCodigoViaHtml(BASE_URL, BASE_URL)
  if (codigoDescuento) {
    console.log(`[pelotapadel] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
  }
  if (rebajasUrls.length > 0) {
    console.log(`[pelotapadel] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
  }

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
