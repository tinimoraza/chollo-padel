// scripts/prices/scrapers/m1padel.js
// PrestaShop — fetch + cheerio
// Categoría palas-de-padel-5 con paginación ?page=N (423 productos, ~11 páginas)

const SOURCE_KEY = 'm1padel'
const BASE_URL   = 'https://www.m1padel.com'
const CAT_PATH   = '/palas-de-padel-5'
const DELAY_MS   = 600

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function parsePrice(text) {
  if (!text) return NaN
  const m = text.match(/([\d.]+,\d{2})/)
  if (!m) return NaN
  return parseFloat(m[1].replace('.', '').replace(',', '.'))
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function parseArticles($, articles) {
  const out = []
  articles.each((_, art) => {
    const $a = $(art)
    const titleEl = $a.find('[itemprop="name"], .product-title a, h3 a, h2 a').first()
    const title = titleEl.text().trim()
    const linkEl = $a.find('a.product-thumbnail, a[itemprop="url"]').first()
    const url = linkEl.attr('href') || titleEl.attr('href')
    if (!title || !url) return

    const price    = parsePrice($a.find('[itemprop="price"], .price').first().text())
    const original = parsePrice($a.find('.regular-price, .old-price').first().text())
    if (isNaN(price) || price < 30) return

    // Imagen — PrestaShop suele usar lazy-load (data-src) sobre img.product-thumbnail-first
    const imgEl  = $a.find('img.product-thumbnail-first, img').first()
    const rawImg = imgEl.attr('data-src') || imgEl.attr('src') || ''
    let image = (!rawImg || rawImg.startsWith('data:') || rawImg.includes('blank.png'))
      ? null
      : (rawImg.split('?')[0] || null)
    if (image && !image.startsWith('http')) image = 'https://www.m1padel.com' + (image.startsWith('/') ? '' : '/') + image
    if (image && /\/cms\/|\/banner|\/slide/i.test(image)) image = null

    out.push({
      title,
      price,
      precio_original: (!isNaN(original) && original > price) ? original : null,
      url,
      image,
    })
  })
  return out
}

async function scrapeAll(load, detectarCodigoDescuento, filtrarUrlsRebajas) {
  const products = []
  const seenUrls = new Set()
  let page = 1
  let codigoDescuento = null
  let rebajasUrls = []
  const CAT_URL = `${BASE_URL}${CAT_PATH}`

  while (true) {
    const url = page === 1
      ? CAT_URL
      : `${BASE_URL}${CAT_PATH}?page=${page}`

    let html
    try { html = await fetchPage(url) }
    catch (e) { console.error(`[m1padel] Error ${url}:`, e.message); break }

    const $ = load(html)
    const articles = $('article.product-miniature')
    if (articles.length === 0) break

    if (page === 1) {
      codigoDescuento = detectarCodigoDescuento($('body').text())
      if (codigoDescuento) {
        console.log(`[m1padel] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
      }
      const hrefs = $('a[href]').map((_, a) => $(a).attr('href')).get()
      rebajasUrls = filtrarUrlsRebajas(hrefs, CAT_URL)
      if (rebajasUrls.length > 0) {
        console.log(`[m1padel] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
      }
    }

    let lastPage = page
    $('.pagination a').each((_, a) => {
      const href = $(a).attr('href') || ''
      const m = href.match(/page=(\d+)/)
      if (m) {
        const n = parseInt(m[1])
        if (!isNaN(n) && n > lastPage) lastPage = n
      }
    })

    for (const item of parseArticles($, articles)) {
      if (seenUrls.has(item.url)) continue
      seenUrls.add(item.url)
      products.push(item)
    }

    console.log(`[m1padel] p${page}/${lastPage} → ${articles.length} productos`)

    if (page >= lastPage) break
    page++
    await sleep(DELAY_MS)
  }

  for (const rebajasUrl of rebajasUrls) {
    let html
    try { html = await fetchPage(rebajasUrl) }
    catch (e) { console.error(`[m1padel] Error sección rebajas ${rebajasUrl}:`, e.message); continue }

    const $ = load(html)
    const articles = $('article.product-miniature')
    let added = 0
    for (const item of parseArticles($, articles)) {
      if (seenUrls.has(item.url)) continue
      seenUrls.add(item.url)
      products.push(item)
      added++
    }
    console.log(`[m1padel] sección rebajas ${rebajasUrl} → ${added} productos nuevos`)
    await sleep(DELAY_MS)
  }

  products.codigoDescuento = codigoDescuento
  return products
}

async function scrape() {
  console.log('[m1padel] Iniciando scraper (fetch + cheerio)…')

  let load
  try { ({ load } = require('cheerio')) }
  catch { console.error('[m1padel] cheerio no instalado'); return [] }

  const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

  const products = await scrapeAll(load, detectarCodigoDescuento, filtrarUrlsRebajas)
  console.log(`[m1padel] Total palas: ${products.length}`)

  const scraped_at = new Date().toISOString()
  const resultado = products.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    image:           p.image ?? null,
    scraped_at,
  }))
  resultado.codigoDescuento = products.codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
