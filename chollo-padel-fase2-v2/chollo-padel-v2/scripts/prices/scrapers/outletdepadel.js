// scripts/prices/scrapers/outletdepadel.js
// Outlet de Padel — WooCommerce (fetch + cheerio)
// URL catálogo: https://outletdepadel.com/palas-padel/
// Paginación: /page/N/

const SOURCE_KEY = 'outletdepadel'
const BASE_URL   = 'https://outletdepadel.com'
const CAT_PATH   = '/palas-padel'
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
  console.log('[outletdepadel] Iniciando scraper (WooCommerce fetch + cheerio)…')

  let cheerio
  try { cheerio = require('cheerio') } catch {
    console.error('[outletdepadel] cheerio no instalado'); return []
  }

  const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

  function parseCards($, cards) {
    const out = []
    cards.each((_, el) => {
      const $c = $(el)

      const linkEl = $c.find('a.woocommerce-loop-product__link, .woocommerce-LoopProduct-link').first()
      const href   = linkEl.attr('href')
      const title  = $c.find('.woocommerce-loop-product__title, h2.product-title, h2').first().text().trim()
      if (!title || !href || !isPala(title)) return

      const priceEl  = $c.find('.price')
      const insPrice = parsePrice(priceEl.find('ins .amount, ins').first().text())
      const basePr   = parsePrice(priceEl.find('> .amount').first().text())
      const price    = !isNaN(insPrice) ? insPrice : (!isNaN(basePr) ? basePr : parsePrice(priceEl.text()))
      const original = parsePrice(priceEl.find('del .amount, del').first().text())

      if (isNaN(price) || price < 30) return

      const imgEl  = $c.find('img').first()
      const rawImg = imgEl.attr('data-src') || imgEl.attr('src') || ''
      const image  = rawImg.startsWith('data:') ? null : (rawImg.split('?')[0] || null)

      out.push({
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url: href,
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
      ? `${BASE_URL}${CAT_PATH}/`
      : `${BASE_URL}${CAT_PATH}/page/${page}/`

    let html
    try { html = await fetchPage(url) }
    catch (e) { console.error(`[outletdepadel] Error ${url}:`, e.message); break }

    const $ = cheerio.load(html)
    const cards = $('li.product, .product-item')
    if (cards.length === 0) break

    if (page === 1) {
      codigoDescuento = detectarCodigoDescuento($('body').text())
      if (codigoDescuento) {
        console.log(`[outletdepadel] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
      }
      const hrefs = $('a[href]').map((_, a) => $(a).attr('href')).get()
      rebajasUrls = filtrarUrlsRebajas(hrefs, `${BASE_URL}${CAT_PATH}`)
      if (rebajasUrls.length > 0) {
        console.log(`[outletdepadel] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
      }
    }

    // Detectar última página
    $('.woocommerce-pagination a, .page-numbers a').each((_, a) => {
      const href = $(a).attr('href') || ''
      const m = href.match(/\/page\/(\d+)/)
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

    console.log(`[outletdepadel] página ${page}/${lastPage} → ${cards.length} cards`)

    if (page >= lastPage) break
    page++
    await sleep(DELAY_MS)
  }

  for (const rebajasUrl of rebajasUrls) {
    let html
    try { html = await fetchPage(rebajasUrl) }
    catch (e) { console.error(`[outletdepadel] Error sección rebajas ${rebajasUrl}:`, e.message); continue }
    const $ = cheerio.load(html)
    const cards = $('li.product, .product-item')
    let added = 0
    for (const item of parseCards($, cards)) {
      if (seen.has(item.url)) continue
      seen.add(item.url)
      allProducts.push(item)
      added++
    }
    console.log(`[outletdepadel] sección rebajas ${rebajasUrl} → ${added} productos nuevos`)
    await sleep(DELAY_MS)
  }

  // Para productos sin imagen del listing, extraer og:image de la ficha (WooCommerce lazy-load).
  const sinImagen = allProducts.filter(p => !p.image)
  if (sinImagen.length > 0) {
    console.log(`[outletdepadel] Completando imagen de ficha para ${sinImagen.length} productos sin imagen\u2026`)
    for (const p of sinImagen) {
      try {
        const html = await fetchPage(p.url)
        const $ = cheerio.load(html)
        const ogImg = $('meta[property="og:image"]').attr('content') || null
        if (ogImg) p.image = ogImg
      } catch (e) {
        console.error(`[outletdepadel] No se pudo obtener imagen de ${p.url}:`, e.message)
      }
      await sleep(DELAY_MS)
    }
  }

  console.log(`[outletdepadel] Total palas: ${allProducts.length}`)
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
