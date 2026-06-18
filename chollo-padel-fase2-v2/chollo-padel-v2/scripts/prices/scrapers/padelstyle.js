// scripts/prices/scrapers/padelstyle.js
// WooCommerce — API REST pública (wc/store/v1), no hace falta cheerio/HTML
// https://www.padelstyle.com/wp-json/wc/store/v1/products?category=palas-de-padel

const SOURCE_KEY = 'padelstyle'
const BASE_URL   = 'https://www.padelstyle.com'
const CATEGORY   = 'palas-de-padel'
const PER_PAGE   = 100
const DELAY_MS   = 500

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

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

// Los precios de la Store API vienen como strings de céntimos enteros,
// ej. "31490" = 314,90€. minor_unit indica los decimales (normalmente 2).
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

async function scrape() {
  console.log('[padelstyle] Iniciando scraper (WooCommerce Store API)…')

  const allProducts = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    let result
    try {
      result = await fetchPage(page)
    } catch (e) {
      console.error(`[padelstyle] Error página ${page}:`, e.message)
      break
    }

    const { data, totalPages: tp } = result
    totalPages = tp
    if (!Array.isArray(data) || data.length === 0) break

    for (const p of data) {
      const title = p.name
      const url = p.permalink
      if (!title || !url) continue

      const minorUnit = p.prices?.currency_minor_unit ?? 2
      const salePrice = centsToEuros(p.prices?.sale_price, minorUnit)
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
      })
    }

    console.log(`[padelstyle] página ${page}/${totalPages} → ${data.length} productos`)

    page++
    if (page <= totalPages) await sleep(DELAY_MS)
  }

  console.log(`[padelstyle] Total palas: ${allProducts.length}`)

  const scraped_at = new Date().toISOString()
  return allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original,
    url:             p.url,
    image:           p.image,
    scraped_at,
  }))
}

module.exports = { scrape, SOURCE_KEY }
