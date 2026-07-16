// scripts/prices/scrapers/ofertasdepadel.js
// Scraper Ofertas de Pádel — PrestaShop HTML
//
// URL: https://www.ofertasdepadel.com/es/3-palas-de-padel
// 426 palas (aprox), 12 por página → ~36 páginas
// Paginación: ?page=2, ?page=3...
// Selectores verificados inspeccionando el DOM en vivo:
//   artículo:       article.product-miniature[data-id-product]
//   link:           a.product-thumbnail (href)
//   título:         .product-title a
//   precio actual:  span.product-price
//   precio original: span.regular-price
//   siguiente pág:  a[rel="next"]
//
// FIX 2026-07-16: headers enriquecidos (Sec-Fetch-*, Referer) para evitar 403

const SOURCE_KEY   = 'ofertasdepadel'
const BASE_URL     = 'https://www.ofertasdepadel.com'
const CATEGORY_URL = `${BASE_URL}/es/3-palas-de-padel`
const DELAY_MS     = 1200   // respetuoso con el servidor
const MAX_PAGES    = 50     // techo de seguridad

const HEADERS = {
  'User-Agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language':           'es-ES,es;q=0.9,en;q=0.8',
  'Accept-Encoding':           'gzip, deflate, br',
  'Cache-Control':             'no-cache',
  'Pragma':                    'no-cache',
  'Sec-Fetch-Dest':            'document',
  'Sec-Fetch-Mode':            'navigate',
  'Sec-Fetch-Site':            'none',
  'Sec-Fetch-User':            '?1',
  'Upgrade-Insecure-Requests': '1',
  'Referer':                   'https://www.google.es/',
}

// Productos no pala que pueden colar aunque estén en la categoría
const EXCLUIR = [
  'zapatilla', 'mochila', 'paletero', 'bolsa', 'grip', 'overgrip',
  'pelota', 'pelotas', 'camiseta', 'short', 'polo', 'funda',
  'muñequera', 'visera', 'gorra', 'calcetín', 'calcetines',
  'protector', 'cordaje', 'antivibrador', 'pack ', 'kit ',
  'portabotellas', 'ropa', 'cuerda',
]

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function parsePrice(text) {
  if (!text) return NaN
  // "154,95 €" → 154.95
  return parseFloat(text.replace(/[^\d,]/g, '').replace(',', '.'))
}

async function scrape() {
  console.log('[ofertasdepadel] Iniciando scraper (PrestaShop HTML)…')

  let cheerio
  try {
    cheerio = require('cheerio')
  } catch {
    console.error('[ofertasdepadel] cheerio no instalado — ejecuta: npm install cheerio')
    return []
  }

  const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

  function parseProductos($) {
    const out = []
    $('article.product-miniature').each((_, el) => {
      const $el = $(el)

      const title = $el.find('.product-title a').first().text().trim()
        || $el.find('h3.product-title').first().text().trim()
      if (!title) return
      if (!isPala(title)) return

      const link = $el.find('a.product-thumbnail').first().attr('href')
        || $el.find('.product-title a').first().attr('href')
      if (!link || !link.startsWith('http')) return

      const priceText    = $el.find('span.product-price').first().text()
      const originalText = $el.find('span.regular-price').first().text()
      const price    = parsePrice(priceText)
      const original = parsePrice(originalText)
      if (isNaN(price) || price < 30) return

      const imgEl  = $el.find('a.product-thumbnail img, img').first()
      const rawImg = imgEl.attr('data-src') || imgEl.attr('src') || ''
      const image  = rawImg.startsWith('data:') ? null : (rawImg.split('?')[0] || null)

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
      : `${CATEGORY_URL}?page=${pageNum}`

    console.log(`[ofertasdepadel]   Página ${pageNum}: ${url}`)

    let html
    try {
      const res = await fetch(url, { headers: HEADERS })
      if (!res.ok) {
        console.log(`[ofertasdepadel]   HTTP ${res.status} — deteniendo`)
        break
      }
      html = await res.text()
    } catch (err) {
      console.error(`[ofertasdepadel]   Error fetch página ${pageNum}:`, err.message)
      break
    }

    const $ = cheerio.load(html)

    if (pageNum === 1) {
      codigoDescuento = detectarCodigoDescuento(html)
      if (codigoDescuento) {
        console.log(`[ofertasdepadel] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
      }
      const hrefs = $('a[href]').map((_, a) => $(a).attr('href')).get()
      // Solo secciones de palas (la tienda tiene rebajas de mochilas/ropa/zapatillas
      // que no nos interesan — filtrar por URL para no desperdiciar tiempo)
      rebajasUrls = filtrarUrlsRebajas(hrefs, CATEGORY_URL)
        .filter(u => /pala/i.test(u) && !/paletero/i.test(u))
      if (rebajasUrls.length > 0) {
        console.log(`[ofertasdepadel] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
      }
    }

    const pageProducts = []
    for (const item of parseProductos($)) {
      if (seen.has(item.url)) continue
      seen.add(item.url)
      pageProducts.push(item)
    }

    console.log(`[ofertasdepadel]   → ${pageProducts.length} palas en página ${pageNum}`)
    allProducts.push(...pageProducts)

    // Comprobar si hay página siguiente
    hasMore = $('a[rel="next"]').length > 0
    pageNum++

    if (hasMore) await sleep(DELAY_MS)
  }

  for (const rebajasUrl of rebajasUrls) {
    let html
    try {
      const res = await fetch(rebajasUrl, { headers: HEADERS })
      if (!res.ok) { console.log(`[ofertasdepadel] sección rebajas ${rebajasUrl} HTTP ${res.status}`); continue }
      html = await res.text()
    } catch (err) {
      console.error(`[ofertasdepadel] Error sección rebajas ${rebajasUrl}:`, err.message)
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
    console.log(`[ofertasdepadel] sección rebajas ${rebajasUrl} → ${added} productos nuevos`)
    await sleep(DELAY_MS)
  }

  console.log(`[ofertasdepadel] Total palas: ${allProducts.length}`)
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
