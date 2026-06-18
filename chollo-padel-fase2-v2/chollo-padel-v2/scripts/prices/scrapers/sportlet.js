// scripts/prices/scrapers/sportlet.js
// Sportlet Store (Italia) — PrestaShop HTML scraping (fetch + cheerio)
// URL catálogo: https://sportlet.store/it/racchette-da-padel
// Paginación: ?page=N

const SOURCE_KEY    = 'sportlet'
const BASE_URL      = 'https://sportlet.store'
const CATEGORY_PATH = '/it/racchette-da-padel'
const DELAY_MS      = 800
const MAX_PAGES     = 40

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Language': 'it-IT,it;q=0.9',
}

// Palabras de exclusión (italiano + genérico) para filtrar accesorios no-palas
const EXCLUIR = ['grip', 'overgrip', 'pallin', 'palline', 'borsa', 'zaino', 'sacca',
  'porta racchet', 'cover', 'protezione', 'fascia', 'maglietta', 'scarpe', 'pack ', 'kit ']

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
  console.log('[sportlet] Iniciando scraper (PrestaShop HTML)…')

  let cheerio
  try { cheerio = require('cheerio') } catch {
    console.error('[sportlet] cheerio no instalado'); return []
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
    catch (e) { console.error(`[sportlet] Error ${url}:`, e.message); break }

    const $ = cheerio.load(html)
    const cards = $('article.product-miniature, .js-product-miniature')
    if (cards.length === 0) break

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

      const linkEl = $card.find('h3.product-title a, h2.product-title a, .product-title a').first()
      const title  = linkEl.text().trim()
      const href   = linkEl.attr('href')
      if (!title || !href || !isPala(title) || seen.has(href)) return
      seen.add(href)

      const priceEl = $card.find('span.product-price, .price').first()
      const price   = priceEl.attr('content')
        ? parseFloat(priceEl.attr('content'))
        : parsePrice(priceEl.text())
      if (isNaN(price) || price < 30) return

      const original = parsePrice($card.find('.regular-price').first().text())

      // Aviso: sportlet.store usa lazy-load por JS para imágenes (placeholder.jpg en HTML estático);
      // se intenta data-src primero, si solo hay placeholder se descarta a null.
      const imgEl  = $card.find('img.product-thumbnail-first, img').first()
      const rawImg = imgEl.attr('data-src') || imgEl.attr('src') || ''
      const isPlaceholder = rawImg.includes('placeholder') || rawImg.includes('blank.png')
      const image  = (!rawImg || rawImg.startsWith('data:') || isPlaceholder) ? null : (rawImg.split('?')[0] || null)

      allProducts.push({
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url: href,
        image,
      })
    })

    console.log(`[sportlet] página ${page}/${lastPage} → ${cards.length} cards`)

    if (page >= lastPage) break
    page++
    await sleep(DELAY_MS)
  }

  console.log(`[sportlet] Total palas: ${allProducts.length}`)
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
