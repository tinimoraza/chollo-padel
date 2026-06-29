// scripts/prices/scrapers/virtualpadel.js
// Virtual Padel — WooCommerce + Elementor Loop Grid (fetch + cheerio)
// URL catálogo: https://virtualpadel.es/palas-de-padel/
// Paginación: /page/N/
// NOTA (fix 2026-06-18): el tema usa Elementor "Loop Grid" para listar productos.
// Las tarjetas NO son <li class="product"> (markup clásico WooCommerce) sino
// <div class="... product type-product ...">. WooCommerce sigue añadiendo las
// clases "product" y "type-product" vía post_class(), así que ese selector es
// estable. El título+link está en h2.elementor-heading-title > a (no en
// a.woocommerce-loop-product__link, que este tema no usa).
//
// NOTA (fix 2026-06-18 #2): BUG de paginación — la detección de lastPage buscaba
// `.woocommerce-pagination a, .page-numbers a` (un <a> DENTRO de un contenedor con
// esa clase). Pero el tema Elementor pinta el paginador como
// `<nav class="elementor-pagination"><a class="page-numbers next" href=".../page/2/">`
// — el <a> ES el elemento con clase "page-numbers", no un descendiente. El selector
// CSS ".page-numbers a" nunca matcheaba nada → lastPage quedaba fijo en 1 y el
// scraper paraba tras la página 1, aunque la tienda tenía más páginas (detectado
// porque el catálogo solo devolvía 19 palas, sospechosamente pocas para una tienda
// activa — verificado en vivo: existe /palas-de-padel/page/2/). Fix: seleccionar
// también los propios `a.page-numbers` y `a` dentro de `.elementor-pagination`.

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

  const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

  function parseCards($, cards) {
    const out = []
    cards.each((_, el) => {
      const $c = $(el)

      const linkEl = $c.find('h2.elementor-heading-title a, a.woocommerce-loop-product__link').first()
      const href   = linkEl.attr('href')
      const title  = linkEl.text().trim()
      if (!title || !href || !isPala(title)) return

      const priceEl   = $c.find('.price')
      const insPrice  = parsePrice(priceEl.find('ins .amount, ins').first().text())
      const basePrice = parsePrice(priceEl.find('> .amount').first().text())
      const price     = !isNaN(insPrice) ? insPrice : (!isNaN(basePrice) ? basePrice : parsePrice(priceEl.text()))
      const original  = parsePrice(priceEl.find('del .amount, del').first().text())

      if (isNaN(price) || price < 30) return

      const imgEl  = $c.find('img.vp-main-image, img').first()
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
    catch (e) { console.error(`[virtualpadel] Error ${url}:`, e.message); break }

    const $ = cheerio.load(html)
    const cards = $('.product.type-product')
    if (cards.length === 0) break

    if (page === 1) {
      codigoDescuento = detectarCodigoDescuento($('body').text())
      if (codigoDescuento) {
        console.log(`[virtualpadel] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
      }
      const hrefs = $('a[href]').map((_, a) => $(a).attr('href')).get()
      rebajasUrls = filtrarUrlsRebajas(hrefs, `${BASE_URL}${CAT_PATH}`)
      if (rebajasUrls.length > 0) {
        console.log(`[virtualpadel] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
      }
    }

    // Detectar última página desde paginación WooCommerce
    $('.woocommerce-pagination a, .page-numbers a, a.page-numbers, .elementor-pagination a').each((_, a) => {
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

    console.log(`[virtualpadel] página ${page}/${lastPage} → ${cards.length} cards`)

    if (page >= lastPage) break
    page++
    await sleep(DELAY_MS)
  }

  for (const rebajasUrl of rebajasUrls) {
    let html
    try { html = await fetchPage(rebajasUrl) }
    catch (e) { console.error(`[virtualpadel] Error sección rebajas ${rebajasUrl}:`, e.message); continue }
    const $ = cheerio.load(html)
    const cards = $('.product.type-product')
    let added = 0
    for (const item of parseCards($, cards)) {
      if (seen.has(item.url)) continue
      seen.add(item.url)
      allProducts.push(item)
      added++
    }
    console.log(`[virtualpadel] sección rebajas ${rebajasUrl} → ${added} productos nuevos`)
    await sleep(DELAY_MS)
  }

  console.log(`[virtualpadel] Total palas: ${allProducts.length}`)
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
