// scripts/prices/scrapers/stockpadel.js
// StockPadel — PrestaShop HTML scraping (fetch + cheerio)
// URL catálogo: https://www.stockpadel.com/es/31-ofertas-palas-de-padel (solo ofertas)
// Paginación: ?page=N

const SOURCE_KEY    = 'stockpadel'
const BASE_URL      = 'https://www.stockpadel.com'
const CATEGORY_PATH = '/es/31-ofertas-palas-de-padel'
const DELAY_MS      = 800
const MAX_PAGES     = 40

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Language': 'es-ES,es;q=0.9',
}

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla', 'pack ']

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
  console.log('[stockpadel] Iniciando scraper (PrestaShop HTML)…')

  let cheerio
  try { cheerio = require('cheerio') } catch {
    console.error('[stockpadel] cheerio no instalado'); return []
  }

  const allProducts = []
  const seen = new Set()
  let page = 1
  let lastPage = 1

  while (page <= MAX_PAGES) {
    const url = page === 1
      ? `${BASE_URL}${CATEGORY_PATH}`
      : `${BASE_URL}${CATEGORY_PATH}?page=${page}`

    let html
    try { html = await fetchPage(url) }
    catch (e) { console.error(`[stockpadel] Error ${url}:`, e.message); break }

    const $ = cheerio.load(html)
    const cards = $('article.product-miniature, .js-product-miniature')
    if (cards.length === 0) break

    // Detectar última página desde la paginación
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

      // Título y URL — stockpadel usa <h3 class="product-title"><a href="...">Título</a></h3>
      const linkEl = $card.find('h3.product-title a').first()
      const title  = linkEl.text().trim()
      const href   = linkEl.attr('href')
      if (!title || !href || !isPala(title) || seen.has(href)) return
      seen.add(href)

      // Precio — <span class="product-price" content="109.99">109,99 €</span>
      const priceEl = $card.find('span.product-price').first()
      const price   = priceEl.attr('content')
        ? parseFloat(priceEl.attr('content'))
        : parsePrice(priceEl.text())
      if (isNaN(price) || price < 30) return

      // Precio original tachado — <span class="regular-price">220,00 €</span>
      const original = parsePrice($card.find('.regular-price').first().text())

      // Imagen — lazy load en data-src de img.product-thumbnail-first
      const imgEl  = $card.find('img.product-thumbnail-first').first()
      const rawImg = imgEl.attr('data-src') || imgEl.attr('src') || ''
      const image  = rawImg.startsWith('data:') || rawImg.includes('blank.png') ? null : (rawImg.split('?')[0] || null)

      allProducts.push({
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url: href,
        image,
      })
    })

    console.log(`[stockpadel] página ${page}/${lastPage} → ${cards.length} cards`)

    if (page >= lastPage) break
    page++
    await sleep(DELAY_MS)
  }

  console.log(`[stockpadel] Total palas: ${allProducts.length}`)
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
