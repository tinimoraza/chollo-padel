// scripts/prices/scrapers/padelvice.js
// PadelVice — WooCommerce HTML scraping
// Plataforma: WooCommerce 10.8.0 (API REST bloqueada con 403)
// URL categoría: https://www.padelvice.com/categoria-producto/palas-de-padel/
// Paginación: /page/2/
//
// Ejecutar:
//   node scripts/prices/pipeline.js padelvice

const SOURCE_KEY   = 'padelvice'
const BASE_URL     = 'https://www.padelvice.com'
const CATEGORY_URL = `${BASE_URL}/categoria-producto/palas-de-padel/`
const DELAY_MS     = 1000
const MAX_PAGES    = 20

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control':   'no-cache',
  'Pragma':          'no-cache',
  'Sec-Fetch-Dest':  'document',
  'Sec-Fetch-Mode':  'navigate',
  'Sec-Fetch-Site':  'none',
  'Sec-Fetch-User':  '?1',
  'Upgrade-Insecure-Requests': '1',
}

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla', 'pickleball']

function isPala(title) {
  return !EXCLUIR.some(w => title.toLowerCase().includes(w))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function parsePrice(text) {
  if (!text) return NaN
  // WooCommerce: "269,95€" o "269.95€"
  return parseFloat(text.replace(/[^\d,\.]/g, '').replace(',', '.'))
}

async function scrape() {
  console.log('[padelvice] Iniciando scraper (WooCommerce HTML)…')

  let cheerio
  try { cheerio = require('cheerio') } catch {
    console.error('[padelvice] cheerio no instalado'); return []
  }

  const allProducts = []
  const seen = new Set()
  let pageNum = 1
  let hasMore = true

  while (hasMore && pageNum <= MAX_PAGES) {
    const url = pageNum === 1
      ? CATEGORY_URL
      : `${CATEGORY_URL}page/${pageNum}/`

    console.log(`[padelvice]   Página ${pageNum}: ${url}`)

    let html
    try {
      const res = await fetch(url, { headers: HEADERS })
      if (!res.ok) { console.log(`[padelvice]   HTTP ${res.status} — fin`); break }
      html = await res.text()
    } catch (err) {
      console.error(`[padelvice]   Error:`, err.message); break
    }

    const $ = cheerio.load(html)
    const pageProducts = []

    // PadelVice usa tema custom — los productos son los items de la lista del menú
    // con links a /tienda/palas-de-padel/. Iteramos por los links de producto.
    const seen2 = new Set() // local para evitar duplicados de link en esta página
    $('a[href*="/tienda/palas-de-padel/"]').each((_, el) => {
      const $a = $(el)
      const link = $a.attr('href')
      if (!link || !link.startsWith('http') || seen.has(link) || seen2.has(link)) return

      // Descartar links de "add-to-cart"
      if (link.includes('add-to-cart') || link.includes('?')) return

      // El título está en el texto del link o en el h4 hermano
      let title = $a.text().trim()
      if (!title || title.length < 3) {
        // Buscar h4 en el mismo contenedor padre
        const $li = $a.closest('li, .product, article')
        title = $li.find('h2, h3, h4').first().text().trim()
      }
      if (!title || !isPala(title)) return

      // Precios en el contenedor padre
      const $container = $a.closest('li, .product, article, div')
      const priceIns = $container.find('ins .woocommerce-Price-amount, ins bdi').first().text()
      const priceDel = $container.find('del .woocommerce-Price-amount, del bdi').first().text()
      const priceStd = $container.find('.woocommerce-Price-amount, bdi').first().text()

      const price    = parsePrice(priceIns || priceStd)
      const original = parsePrice(priceDel)
      if (isNaN(price) || price < 30) return

      // Imagen — WordPress/WooCommerce hace lazy-load (data-src con la url real).
      const imgEl  = $container.find('img').first()
      const rawImg = imgEl.attr('data-src') || imgEl.attr('src') || ''
      const image  = rawImg.startsWith('data:') ? null : (rawImg.split('?')[0] || null)

      seen2.add(link)
      seen.add(link)
      pageProducts.push({
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url: link,
        image,
      })
    })

    console.log(`[padelvice]   → ${pageProducts.length} palas en página ${pageNum}`)
    allProducts.push(...pageProducts)

    // WooCommerce paginación: /page/N/
    hasMore = $('a.next.page-numbers, .woocommerce-pagination a.next, a[href*="/page/"]').filter((_, el) => {
      const href = $(el).attr('href') ?? ''
      return href.includes(`/page/${pageNum + 1}/`)
    }).length > 0
    pageNum++
    if (hasMore) await sleep(DELAY_MS)
  }

  console.log(`[padelvice] Total palas: ${allProducts.length}`)
  const scraped_at = new Date().toISOString()
  return allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    image:           p.image ?? null,
    scraped_at,
  }))
}

module.exports = { scrape, SOURCE_KEY }
