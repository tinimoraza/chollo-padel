// scripts/prices/scrapers/virtualpadel.js
// Virtual Padel — WooCommerce (fetch + cheerio)
// URL catálogo: https://virtualpadel.es/palas-de-padel/
// Paginación: /page/N/

const SOURCE_KEY = 'virtualpadel'
const BASE_URL   = 'https://virtualpadel.es'
const CAT_PATH   = '/palas-de-padel'
const DELAY_MS   = 800
const MAX_PAGES  = 40

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Language': 'es-ES,es;q=0.9',
}

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla', 'pack ']

function isPala(title) {
  return !EXCLUIR.some(w => title.toLowerCase().includes(w))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function parsePrice(text) {
  if (!text) return NaN
  const m = text.match(/([\d.]+,\d{2})/) || text.match(/(\d+\.\d{2})/)
  if (!m) return NaN
  return parseFloat(m[1].replace('.', '').replace(',', '.'))
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function scrape() {
  console.log('[virtualpadel] Iniciando scraper (WooCommerce fetch + cheerio)…')

  let cheerio
  try { cheerio = require('cheerio') } catch {
    console.error('[virtualpadel] cheerio no instalado'); return []
  }

  const allProducts = []
  const seen = new Set()
  let page = 1
  let lastPage = 1

  while (page <= MAX_PAGES) {
    const url = page === 1
      ? `${BASE_URL}${CAT_PATH}/`
      : `${BASE_URL}${CAT_PATH}/page/${page}/`

    let html
    try { html = await fetchPage(url) }
    catch (e) { console.error(`[virtualpadel] Error ${url}:`, e.message); break }

    const $ = cheerio.load(html)
    const cards = $('li.product, .product-item')
    if (cards.length === 0) break

    // Detectar última página desde paginación WooCommerce
    $('.woocommerce-pagination a, .page-numbers a').each((_, a) => {
      const href = $(a).attr('href') || ''
      const m = href.match(/\/page\/(\d+)/)
      if (m) {
        const n = parseInt(m[1])
        if (!isNaN(n) && n > lastPage) lastPage = n
      }
    })

    cards.each((_, el) => {
      const $c = $(el)

      const linkEl = $c.find('a.woocommerce-loop-product__link, .woocommerce-LoopProduct-link').first()
      const href   = linkEl.attr('href')
      const title  = $c.find('.woocommerce-loop-product__title, h2.product-title, h2').first().text().trim()
      if (!title || !href || !isPala(title) || seen.has(href)) return
      seen.add(href)

      // WooCommerce: precio en oferta en <ins>, precio original en <del>
      const priceEl   = $c.find('.price')
      const insPrice  = parsePrice(priceEl.find('ins .amount, ins').first().text())
      const basePrice = parsePrice(priceEl.find('> .amount').first().text())
      const price     = !isNaN(insPrice) ? insPrice : (!isNaN(basePrice) ? basePrice : parsePrice(priceEl.text()))
      const original  = parsePrice(priceEl.find('del .amount, del').first().text())

      if (isNaN(price) || price < 30) return

      const imgEl  = $c.find('img').first()
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

    console.log(`[virtualpadel] página ${page}/${lastPage} → ${cards.length} cards`)

    if (page >= lastPage) break
    page++
    await sleep(DELAY_MS)
  }

  console.log(`[virtualpadel] Total palas: ${allProducts.length}`)
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
