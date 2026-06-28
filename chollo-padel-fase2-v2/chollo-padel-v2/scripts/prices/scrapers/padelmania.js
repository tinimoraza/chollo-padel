// scripts/prices/scrapers/padelmania.js
// Padelmania - PrestaShop HTML scraping (fetch + cheerio)
// URL catalogo: https://padelmania.com/es/338-todas-las-palas-de-padel (todas las palas, ~196 productos)
// Paginacion: ?page=N

const SOURCE_KEY    = 'padelmania'
const BASE_URL      = 'https://padelmania.com'
const CATEGORY_PATH = '/es/338-todas-las-palas-de-padel'
const DELAY_MS      = 800
const MAX_PAGES     = 40

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Language': 'es-ES,es;q=0.9',
}

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'munequera', 'camiseta', 'zapatilla', 'pack ']

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function parsePrice(text) {
  if (!text) return NaN
  const m = text.match(/([\d.]+,\d{2})/)
  if (!m) return NaN
  return parseFloat(m[1].replace('.', '').replace(',', '.'))
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function scrape() {
  console.log('[padelmania] Iniciando scraper (PrestaShop HTML)...')

  let cheerio
  try { cheerio = require('cheerio') } catch {
    console.error('[padelmania] cheerio no instalado'); return []
  }

  const { detectarCodigoDescuento } = require('./_discount-utils.js')

  const allProducts = []
  const seen = new Set()
  let page = 1
  let lastPage = 1
  // Piloto 2026-06-28: padelmania muestra un banner de cupon site-wide
  // ("CODIGO: PADELMANIA10 -10% EXTRA") en la cabecera de cada pagina de
  // categoria - basta con mirar la pagina 1, no hace falta repetir por
  // pagina. Validado contra HTML real (ver _discount-utils.js).
  let codigoDescuento = null

  while (page <= MAX_PAGES) {
    const url = page === 1
      ? `${BASE_URL}${CATEGORY_PATH}?resultsPerPage=36`
      : `${BASE_URL}${CATEGORY_PATH}?resultsPerPage=36&page=${page}`

    let html
    try { html = await fetchPage(url) }
    catch (e) { console.error(`[padelmania] Error ${url}:`, e.message); break }

    const $ = cheerio.load(html)
    const cards = $('article.product-miniature, .js-product-miniature')
    if (cards.length === 0) break

    if (page === 1) {
      codigoDescuento = detectarCodigoDescuento($('body').text())
      if (codigoDescuento) {
        console.log(`[padelmania] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
      }
    }

    // Detectar ultima pagina desde la paginacion
    $('.pagination a').each((_, a) => {
      const href = $(a).attr('href') || ''
      const m = href.match(/page=(\d+)/)
      if (m) {
        const n = parseInt(m[1])
        if (!isNaN(n) && n > lastPage) lastPage = n
      }
    })

    cards.each((_, el) => {
      const $card = $(el)

      // Titulo y URL
      const linkEl = $card.find('h3.product-title a, h2.product-title a').first()
      const title  = linkEl.text().trim()
      const href   = linkEl.attr('href')
      if (!title || !href || !isPala(title) || seen.has(href)) return
      seen.add(href)

      // Precio
      const priceEl = $card.find('span.product-price').first()
      const price   = priceEl.attr('content')
        ? parseFloat(priceEl.attr('content'))
        : parsePrice(priceEl.text())
      if (isNaN(price) || price < 30) return

      // Precio original tachado
      const original = parsePrice($card.find('.regular-price').first().text())

      // Imagen - lazy load en data-src
      const imgEl  = $card.find('img').first()
      const rawImg = imgEl.attr('data-src') || imgEl.attr('src') || ''
      const image  = rawImg.startsWith('data:') ? null : (rawImg.split('?')[0] || null)

      allProducts.push({
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url: href,
        image,
      })
    })

    console.log(`[padelmania] pagina ${page}/${lastPage} -> ${cards.length} cards`)

    if (page >= lastPage) break
    page++
    await sleep(DELAY_MS)
  }

  console.log(`[padelmania] Total palas: ${allProducts.length}`)
  const scraped_at = new Date().toISOString()
  const resultado = allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    image:           p.image ?? null,
    scraped_at,
  }))
  // Propiedad a nivel de array (no de producto): pipeline-tiendas.ts la lee
  // en su wrapper scrape() y la propaga a cada price_snapshot de esta tienda.
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
