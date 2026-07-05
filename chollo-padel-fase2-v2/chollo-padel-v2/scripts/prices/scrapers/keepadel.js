// scripts/prices/scrapers/keepadel.js
// Keepadel - PrestaShop HTML scraping (mismo motor que padelspain.js)
// URL real (verificada en vivo 2026-06-30):
//   https://keepadel.com/es/9-palas-de-padel        (catalogo completo de palas)
//   https://keepadel.com/es/95-ofertas-en-palas-de-padel  (subconjunto en oferta,
//     176/187 productos - ya incluido en el catalogo completo, no se scrapea
//     aparte para no duplicar peticiones)
// v2 (2026-06-30): el dry-run real de Patricia dio HTTP 403 en la primera
// peticion (?resultsPerPage=99999). Ese parametro es poco habitual (no lo
// pide un visitante normal) y es plausible que dispare una regla anti-bot/
// WAF - se quita y se vuelve a paginacion normal ?page=N, igual que
// padelspain.js (que si funciona ahi). Tambien se amplia el set de headers
// para parecerse mas a una peticion real de navegador (Accept-Encoding,
// Connection, Sec-Fetch-*, Referer en paginas >1). Pendiente de confirmar
// con un nuevo --dry-run si esto resuelve el 403 - si sigue dando 403 con
// headers de navegador completos, lo mas probable es un WAF (Cloudflare o
// similar) con verificacion de TLS/JS que no se puede pasar con fetch()
// plano y haria falta Playwright (como ya se hace con otras tiendas
// protegidas en el grupo "Playwright" del workflow).
//
// NOTA selectores (2026-06-30): no se ha podido verificar el HTML crudo con
// curl (sandbox sin acceso de red directo, solo via fetch-tool que devuelve
// markdown ya limpiado de clases). Los selectores de abajo cubren los
// patrones de marcado mas comunes en temas PrestaShop 1.6/1.7 (incl. el
// mismo patron que ya usa padelspain.js, que es la misma plataforma) mas
// alguna alternativa extra. Si el dry-run (con red real) da 0 productos
// tras resolver el 403, hay que reabrir y ajustar el selector de tarjeta o
// titulo - NO asumir que funciona sin confirmarlo con un run real.

const SOURCE_KEY     = 'keepadel'
const BASE_URL       = 'https://keepadel.com'
const CATEGORY_PATH  = '/es/9-palas-de-padel'
const DELAY_MS       = 800
// v3 (2026-06-30): el dry-run real con el fix del 403 detecto lastPage=93
// via paginacion (.pagination a), pero el tope MAX_PAGES=40 cortaba la
// recoleccion antes de llegar al final -> se perdian potencialmente
// cientos de palas del catalogo completo. Se sube el tope a 150 para
// dar margen sobre las 93 paginas reales observadas.
const MAX_PAGES      = 150

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection':      'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest':  'document',
  'Sec-Fetch-Mode':  'navigate',
  'Sec-Fetch-Site':  'none',
  'Sec-Fetch-User':  '?1',
}

const EXCLUIR = ['zapatilla', 'mochila', 'paletero', 'bolsa', 'grip', 'overgrip',
  'pelota', 'pelotas', 'camiseta', 'funda', 'munequera', 'protector', 'pack ',
  'gafas', 'gorra', 'calcetin', 'neceser']

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

async function fetchPage(url, referer) {
  const headers = referer ? { ...HEADERS, Referer: referer } : HEADERS
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function scrape() {
  console.log('[keepadel] Iniciando scraper (PrestaShop HTML)...')

  let cheerio
  try { cheerio = require('cheerio') } catch {
    console.error('[keepadel] cheerio no instalado'); return []
  }

  const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

  const CARD_SEL = '.js-product-miniature, article.product-miniature, .product-miniature'

  function parseCards($, cards) {
    const out = []
    cards.each((_, el) => {
      const $card = $(el)

      // Titulo + link: preferimos el enlace dentro del titulo de producto
      // (h2/h3.product-title), con fallback generico a a[title] que no sea
      // la imagen/miniatura (mismo patron ya validado en padelspain.js).
      let titleEl = $card.find('h2.product-title a, h3.product-title a, .product-title a').first()
      if (titleEl.length === 0) {
        titleEl = $card.find('a[title]').filter((_, a) => $(a).attr('class') === '' || !$(a).attr('class')).first()
      }
      const title = (titleEl.attr('title') || titleEl.text().trim() || '').trim()
      const link  = titleEl.attr('href')
      if (!title || !isPala(title) || !link || !link.startsWith('http')) return

      const price    = parsePrice($card.find('[itemprop="price"], span.price, .product-price, .price').first().text())
      const original = parsePrice($card.find('.regular-price, .old-price, .product-price-old, del').first().text())
      if (isNaN(price) || price < 30) return

      const imgEl  = $card.find('img').first()
      const rawImg = imgEl.attr('data-src') || imgEl.attr('src') || ''
      const image  = rawImg.startsWith('data:') ? null : (rawImg.split('?')[0] || null)

      // Detectar "Fuera de stock" / "Agotado" en tarjeta de listado PrestaShop.
      // Las flags de stock suelen estar en .product-flag o .flag-product; tambien
      // hay temas que ponen clase out-of-stock directamente en el article.
      const flagsText = $card.find('.product-flag, .flag-product, .product-availability, .availability').text().toLowerCase()
      const cardClass = ($card.attr('class') || '').toLowerCase()
      const disponible = !(
        flagsText.includes('fuera') ||
        flagsText.includes('agotado') ||
        flagsText.includes('out-of-stock') ||
        cardClass.includes('out-of-stock') ||
        $card.find('[class*="out-of-stock"]').length > 0
      )

      out.push({
        title, price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url: link,
        image,
        disponible,
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
    const referer = page === 1 ? BASE_URL : `${BASE_URL}${CATEGORY_PATH}${page > 2 ? `?page=${page - 1}` : ''}`

    let html
    try { html = await fetchPage(url, referer) }
    catch (e) { console.error(`[keepadel] Error ${url}:`, e.message); break }

    const $ = cheerio.load(html)
    const cards = $(CARD_SEL)
    if (cards.length === 0) break

    if (page === 1) {
      codigoDescuento = detectarCodigoDescuento($('body').text())
      if (codigoDescuento) {
        console.log(`[keepadel] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
      }
      const hrefs = $('a[href]').map((_, a) => $(a).attr('href')).get()
      rebajasUrls = filtrarUrlsRebajas(hrefs, `${BASE_URL}${CATEGORY_PATH}`)
      if (rebajasUrls.length > 0) {
        console.log(`[keepadel] secciones de rebajas detectadas: ${rebajasUrls.join(', ')}`)
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

    console.log(`[keepadel] pagina ${page}/${lastPage} -> ${cards.length} cards`)

    if (page >= lastPage) break
    page++
    await sleep(DELAY_MS)
  }

  for (const rebajasUrl of rebajasUrls) {
    let html
    try { html = await fetchPage(rebajasUrl) }
    catch (e) { console.error(`[keepadel] Error seccion rebajas ${rebajasUrl}:`, e.message); continue }
    const $ = cheerio.load(html)
    const cards = $(CARD_SEL)
    let added = 0
    for (const item of parseCards($, cards)) {
      if (seen.has(item.url)) continue
      seen.add(item.url)
      allProducts.push(item)
      added++
    }
    console.log(`[keepadel] seccion rebajas ${rebajasUrl} -> ${added} productos nuevos`)
    await sleep(DELAY_MS)
  }

  console.log(`[keepadel] Total palas: ${allProducts.length}`)
  const scraped_at = new Date().toISOString()
  const resultado = allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    image:           p.image ?? null,
    disponible:      p.disponible !== false,
    scraped_at,
  }))
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
