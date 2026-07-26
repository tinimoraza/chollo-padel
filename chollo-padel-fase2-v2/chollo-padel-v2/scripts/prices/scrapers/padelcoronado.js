// scripts/prices/scrapers/padelcoronado.js
// WooCommerce Store API (wc/store/v1) — sin Playwright, sin cheerio
//
// Fix 2026-07-26: reescrito. El scraper anterior usaba Playwright (headless
// Chromium), pero padelcoronado.com bloquea los navegadores automatizados
// (CDN/firewall sirve página en blanco a Playwright headless). El HTML SSR
// y la Store API son accesibles directamente con fetch normal.
//
// Endpoint: /wp-json/wc/store/v1/products?category=palas-padel
// Precios: strings de céntimos ("15995" = 159,95€), minor_unit=2 por defecto
// Total: ~149 palas en 2 páginas (per_page=100)

const { detectarRebajasYCodigoViaHtml } = require('./_discount-utils.js')

const SOURCE_KEY = 'padelcoronado'
const BASE_URL   = 'https://padelcoronado.com'
const CATEGORY   = 'palas-padel'
const PER_PAGE   = 100
const DELAY_MS   = 500

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// Los precios vienen como strings de céntimos enteros, e.g. "15995" → 159,95€
function centsToEuros(centsStr, minorUnit) {
  if (centsStr == null || centsStr === '') return NaN
  const n = parseInt(centsStr, 10)
  if (isNaN(n)) return NaN
  return n / Math.pow(10, minorUnit ?? 2)
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
      'Accept':     'application/json',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const totalPages = parseInt(res.headers.get('x-wp-totalpages') || '1', 10)
  const data = await res.json()
  return { data, totalPages }
}

async function scrape() {
  console.log('[padelcoronado] Iniciando scraper (WooCommerce Store API)…')

  const allProducts = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    let result
    try {
      result = await fetchPage(page)
    } catch (e) {
      console.error(`[padelcoronado] Error página ${page}:`, e.message)
      break
    }

    const { data, totalPages: tp } = result
    totalPages = tp
    if (!Array.isArray(data) || data.length === 0) break

    for (const p of data) {
      const title = p.name
      const url   = p.permalink
      if (!title || !url) continue

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
        sku: p.sku || null,
      })
    }

    console.log(`[padelcoronado] página ${page}/${totalPages} → ${data.length} productos`)

    page++
    if (page <= totalPages) await sleep(DELAY_MS)
  }

  console.log(`[padelcoronado] Total palas: ${allProducts.length}`)

  // Detección best-effort de código de descuento y secciones de rebajas
  const { codigoDescuento, rebajasUrls } = await detectarRebajasYCodigoViaHtml(
    `${BASE_URL}/categoria-producto/palas-padel/`, BASE_URL
  )
  if (codigoDescuento) {
    console.log(`[padelcoronado] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
  }
  if (rebajasUrls.length > 0) {
    console.log(`[padelcoronado] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
  }

  const scraped_at = new Date().toISOString()
  const resultado = allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original,
    url:             p.url,
    image:           p.image,
    sku:             p.sku ?? null,
    scraped_at,
  }))
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
