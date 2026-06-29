// scripts/prices/scrapers/padelspain.js
// Padel-Spain — PrestaShop HTML scraping
// URL real (verificada en vivo, sin www y con prefijo numérico de categoría):
//   https://padel-spain.es/es/257-palas-de-padel  (paginación ?page=N, 13 páginas)
// La versión anterior usaba https://www.padel-spain.es/palas-padel (y variantes),
// que no son la URL real → 0 resultados siempre. El selector de link de producto
// tampoco era correcto: el <a> del título no tiene clase, solo atributo title=,
// los <a class="tm_gallery_item_box"> son la imagen (también válidos para el link).

const SOURCE_KEY   = 'padelspain'
const BASE_URL      = 'https://padel-spain.es'
const CATEGORY_PATH = '/es/257-palas-de-padel'
const DELAY_MS       = 800
const MAX_PAGES      = 40

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Language': 'es-ES,es;q=0.9',
}

const EXCLUIR = ['zapatilla', 'mochila', 'paletero', 'bolsa', 'grip', 'overgrip',
  'pelota', 'pelotas', 'camiseta', 'funda', 'muñequera', 'protector', 'pack ']

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
  console.log('[padelspain] Iniciando scraper (PrestaShop HTML)…')

  let cheerio
  try { cheerio = require('cheerio') } catch {
    console.error('[padelspain] cheerio no instalado'); return []
  }

  const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

  function parseCards($, cards) {
    const out = []
    cards.each((_, el) => {
      const $card = $(el)
      const titleEl = $card.find('a[title]').filter((_, a) => $(a).attr('class') === '' || !$(a).attr('class')).first()
      const title = (titleEl.attr('title') || titleEl.text().trim() || '').trim()
      const link = titleEl.attr('href')
      if (!title || !isPala(title) || !link || !link.startsWith('http')) return

      const price    = parsePrice($card.find('[itemprop="price"], span.product-price, .price').first().text())
      const original = parsePrice($card.find('.regular-price, .old-price').first().text())
      if (isNaN(price) || price < 30) return

      const imgEl  = $card.find('a.tm_gallery_item_box img, img').first()
      const rawImg = imgEl.attr('data-src') || imgEl.attr('src') || ''
      const image  = rawImg.startsWith('data:') ? null : (rawImg.split('?')[0] || null)

      out.push({
        title, price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url: link,
        image,
      })
    })
    return out
  }

  const allProducts = []
  const seen = new Set()
  let page = 1
  let lastPage = 1
  let codigoDescuento = null
  let rebajasUrls = []

  while (page <= MAX_PAGES) {
    const url = page === 1
      ? `${BASE_URL}${CATEGORY_PATH}`
      : `${BASE_URL}${CATEGORY_PATH}?page=${page}`

    let html
    try { html = await fetchPage(url) }
    catch (e) { console.error(`[padelspain] Error ${url}:`, e.message); break }

    const $ = cheerio.load(html)
    const cards = $('.js-product-miniature, article.product-miniature')
    if (cards.length === 0) break

    if (page === 1) {
      codigoDescuento = detectarCodigoDescuento($('body').text())
      if (codigoDescuento) {
        console.log(`[padelspain] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
      }
      const hrefs = $('a[href]').map((_, a) => $(a).attr('href')).get()
      rebajasUrls = filtrarUrlsRebajas(hrefs, `${BASE_URL}${CATEGORY_PATH}`)
      if (rebajasUrls.length > 0) {
        console.log(`[padelspain] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
      }
    }

    $('.pagination a').each((_, a) => {
      const href = $(a).attr('href') || ''
      const m = href.match(/page=(\d+)/)
      if (m) {
        const n = parseInt(m[1])
        if (!isNaN(n) && n > lastPage) lastPage = n
      }
    })

    for (const item of parseCards($, cards)) {
      if (seen.has(item.url)) continue
      seen.add(item.url)
      allProducts.push(item)
    }

    console.log(`[padelspain] página ${page}/${lastPage} → ${cards.length} cards`)

    if (page >= lastPage) break
    page++
    await sleep(DELAY_MS)
  }

  for (const rebajasUrl of rebajasUrls) {
    let html
    try { html = await fetchPage(rebajasUrl) }
    catch (e) { console.error(`[padelspain] Error sección rebajas ${rebajasUrl}:`, e.message); continue }
    const $ = cheerio.load(html)
    const cards = $('.js-product-miniature, article.product-miniature')
    let added = 0
    for (const item of parseCards($, cards)) {
      if (seen.has(item.url)) continue
      seen.add(item.url)
      allProducts.push(item)
      added++
    }
    console.log(`[padelspain] sección rebajas ${rebajasUrl} → ${added} productos nuevos`)
    await sleep(DELAY_MS)
  }

  console.log(`[padelspain] Total palas: ${allProducts.length}`)
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
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
