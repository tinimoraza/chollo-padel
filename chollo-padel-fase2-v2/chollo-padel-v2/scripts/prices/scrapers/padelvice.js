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

  const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

  function parseProductos($) {
    const out = []
    const seenLocal = new Set()
    $('a[href*="/tienda/palas-de-padel/"]').each((_, el) => {
      const $a = $(el)
      const link = $a.attr('href')
      if (!link || !link.startsWith('http') || seenLocal.has(link)) return
      if (link.includes('add-to-cart') || link.includes('?')) return

      let title = $a.text().trim()
      if (!title || title.length < 3) {
        const $li = $a.closest('li, .product, article')
        title = $li.find('h2, h3, h4').first().text().trim()
      }
      if (!title || !isPala(title)) return

      const $container = $a.closest('li, .product, article, div')
      const priceIns = $container.find('ins .woocommerce-Price-amount, ins bdi').first().text()
      const priceDel = $container.find('del .woocommerce-Price-amount, del bdi').first().text()
      const priceStd = $container.find('.woocommerce-Price-amount, bdi').first().text()

      const price    = parsePrice(priceIns || priceStd)
      const original = parsePrice(priceDel)
      if (isNaN(price) || price < 30) return

      const imgEl  = $container.find('img').first()
      const rawImg = imgEl.attr('data-src') || imgEl.attr('src') || ''
      const image  = rawImg.startsWith('data:') ? null : (rawImg.split('?')[0] || null)

      seenLocal.add(link)
      out.push({
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url: link,
        image,
      })
    })
    return out
  }

  const allProducts = []
  const seen = new Set()
  let pageNum = 1
  let hasMore = true
  let codigoDescuento = null
  let rebajasUrls = []

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

    if (pageNum === 1) {
      codigoDescuento = detectarCodigoDescuento($('body').text())
      if (codigoDescuento) {
        console.log(`[padelvice] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
      }
      const hrefs = $('a[href]').map((_, a) => $(a).attr('href')).get()
      rebajasUrls = filtrarUrlsRebajas(hrefs, CATEGORY_URL)
      if (rebajasUrls.length > 0) {
        console.log(`[padelvice] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
      }
    }

    for (const item of parseProductos($)) {
      if (seen.has(item.url)) continue
      seen.add(item.url)
      pageProducts.push(item)
    }

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

  for (const rebajasUrl of rebajasUrls) {
    let html
    try {
      const res = await fetch(rebajasUrl, { headers: HEADERS })
      if (!res.ok) { console.log(`[padelvice] sección rebajas ${rebajasUrl} HTTP ${res.status}`); continue }
      html = await res.text()
    } catch (err) {
      console.error(`[padelvice] Error sección rebajas ${rebajasUrl}:`, err.message)
      continue
    }
    const $ = cheerio.load(html)
    let added = 0
    for (const item of parseProductos($)) {
      if (seen.has(item.url)) continue
      seen.add(item.url)
      allProducts.push(item)
      added++
    }
    console.log(`[padelvice] sección rebajas ${rebajasUrl} → ${added} productos nuevos`)
    await sleep(DELAY_MS)
  }

  console.log(`[padelvice] Total palas: ${allProducts.length}`)
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
