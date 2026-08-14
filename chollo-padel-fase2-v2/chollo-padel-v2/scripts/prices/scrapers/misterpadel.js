// scripts/prices/scrapers/misterpadel.js
// Mister Padel — Clerk.io API
// Clerk key: oViLXCkVp3oqPERmIdkGDadmGGSm9FA8
// API: https://api.clerk.io/v2/search/search?key=KEY&query=pala+padel&limit=100&offset=0
//      &attributes[]=name&attributes[]=price&attributes[]=list_price&attributes[]=url
//
// NOTA (fix 2026-06-18): la query "pala padel" en Clerk.io es búsqueda libre
// (fuzzy/recomendador), no un filtro de categoría — devolvía ropa y calzado
// (Asics/Nike faldas, mallas, zapatillas...) que disparó el sin-match al 93.9%.
// El campo "product_type" viene vacío en la mayoría de palas reales, así que no
// sirve como filtro. En cambio el campo "categories" (array de IDs numéricos)
// SÍ es fiable: el ID 1 = "Palas de padel" exclusivamente — verificado contra
// ~800 productos, 175 con categories.includes(1) y ninguno de ropa/calzado/
// accesorios lo tenía. Filtramos por esa categoría en vez de por palabras clave.
//
// NOTA (fix 2026-06-18 #3): tras el fix anterior (955→174 productos), seguía
// habiendo 71.8% de sin-match (125/174). Causa: el nombre Clerk.io lleva un
// sufijo " Padel - <Color>" (ej. "Bullpadel Vertex 05 Padel - White/black",
// "adidas Metalbone 2026 Padel - Black/red"). Ese color se filtraba dentro del
// campo "modelo" al extraer atributos (extraerAtributos), y como el catálogo
// no guarda el color ahí, nunca casaba. Confirmado en pruebas locales contra
// extraerAtributos(). Se limpia aquí el sufijo " Padel - ..." antes de usar el
// título, ya que es ruido específico del feed de esta tienda (no del extractor
// genérico, que no debe tocarse para no afectar a otras tiendas).

const { detectarRebajasYCodigoViaHtml } = require('./_discount-utils.js')

// Dominio real de la tienda (no estaba referenciado en el resto del fichero,
// que solo usa la API de Clerk.io) — confirmado vía búsqueda web 2026-06-29:
// www.misterpadel.com (palas: /es/palas-de-padel/).
const SITE_URL    = 'https://www.misterpadel.com/es/'
const CATEGORIA_URL = 'https://www.misterpadel.com/es/palas-de-padel/'

const SOURCE_KEY  = 'misterpadel'
const CLERK_KEY   = 'oViLXCkVp3oqPERmIdkGDadmGGSm9FA8'
const CAT_PALAS   = 1
const LIMIT       = 100
const MAX_ITEMS   = 2000
const MAX_PAGINAS_CATEGORIA = 15

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'es-ES,es;q=0.9',
}

// Fix 2026-08-13: detectado por Patricia — la ficha de producto muestra un
// cupón automático "aplicado en la cesta" (ej. "10% cupón aplicado en la
// cesta / Compra al precio de € 134,90") que NO viene en la API de Clerk.io
// (esta solo trae price/list_price, el precio ANTES del cupón de carrito).
// El % varía por producto (10/15/20%, verificado en vivo) y no todos los
// productos lo llevan — no es un código fijo de tienda, sino un descuento
// automático por producto. Verificado en vivo el 2026-08-13 que SÍ está en
// el HTML servidor (no requiere JS): cada tarjeta del listado de categoría
// (https://www.misterpadel.com/es/palas-de-padel/?p=N) lleva un span
// class="extra discount" con texto "- 10% Extra en el Carrito" cuando aplica.
// Se scrapea ese listado (paginado por ?p=N) solo para sacar el mapa
// url→% y se cruza con los productos ya obtenidos de la API de Clerk.
async function scrapearDescuentosCarrito() {
  let cheerio
  try { cheerio = require('cheerio') } catch {
    console.log('[misterpadel] cheerio no instalado, se omite detección de cupón por producto')
    return new Map()
  }

  const mapa = new Map() // pathname → descuento_pct
  for (let pagina = 1; pagina <= MAX_PAGINAS_CATEGORIA; pagina++) {
    const url = pagina === 1 ? CATEGORIA_URL : `${CATEGORIA_URL}?p=${pagina}`
    let html
    try {
      const res = await fetch(url, { headers: HEADERS })
      if (!res.ok) break
      html = await res.text()
    } catch (err) {
      console.log(`[misterpadel] Error listado categoría página ${pagina}: ${err.message}`)
      break
    }

    const $ = cheerio.load(html)
    const items = $('.display.product-list .item')
    if (items.length === 0) break

    let encontradosPagina = 0
    items.each((_, el) => {
      const $it = $(el)
      const href = $it.find('a[href]').first().attr('href')
      if (!href) return
      let pathname
      try { pathname = new URL(href, CATEGORIA_URL).pathname } catch { return }

      const badgeText = $it.find('.extra.discount').first().text().trim()
      if (!badgeText) return
      const m = badgeText.match(/(\d{1,2})\s*%/)
      if (!m) return

      mapa.set(pathname, parseInt(m[1], 10))
      encontradosPagina++
    })

    console.log(`[misterpadel] listado categoría página ${pagina}: ${items.length} tarjetas, ${encontradosPagina} con cupón de carrito`)
  }

  console.log(`[misterpadel] cupón de carrito detectado en ${mapa.size} productos`)
  return mapa
}

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla', 'shoe',
  'shirt', 'bag', 'string', 'net', 'ball', 'balls', 'accessory', 'calzado']

function esPala(p) {
  if (!Array.isArray(p.categories) || !p.categories.includes(CAT_PALAS)) return false
  const nl = (p.name || '').toLowerCase()
  return !EXCLUIR.some(w => nl.includes(w))
}

async function scrape() {
  console.log('[misterpadel] Iniciando scraper (Clerk.io API)…')

  const allProducts = []
  let offset = 0

  while (offset < MAX_ITEMS) {
    const url = `https://api.clerk.io/v2/search/search?key=${CLERK_KEY}&query=pala+padel&limit=${LIMIT}&offset=${offset}&attributes[]=name&attributes[]=price&attributes[]=list_price&attributes[]=url&attributes[]=categories&attributes[]=image`

    let data
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      data = await res.json()
    } catch (err) {
      console.error(`[misterpadel] Error en offset ${offset}:`, err.message)
      break
    }

    if (data.status !== 'ok' || !data.product_data?.length) break

    for (const p of data.product_data) {
      if (!p.name || !p.url || !p.price) continue
      if (!esPala(p)) continue
      const price    = parseFloat(p.price)
      const original = parseFloat(p.list_price)
      if (isNaN(price) || price < 30) continue
      const title = p.name.replace(/\s+Padel\s*-\s*.+$/i, '').trim()
      allProducts.push({
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url:             p.url,
        image:           p.image || null,
      })
    }

    console.log(`[misterpadel] offset=${offset} → ${data.product_data.length} productos (total acum: ${allProducts.length})`)

    if (data.product_data.length < LIMIT) break
    offset += LIMIT
  }

  // Deduplicar por URL
  const seen = new Set()
  const unique = allProducts.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[misterpadel] Total palas únicas: ${unique.length}`)

  // Cruzar con el cupón de carrito por producto (ver scrapearDescuentosCarrito).
  const mapaCupones = await scrapearDescuentosCarrito()

  // Tienda Clerk.io API-only: petición HTML extra de solo lectura a la home,
  // exclusivamente para detección (código + enlaces a rebajas). No se intenta
  // mergear productos de la sección detectada: Clerk.io no tiene un mapeo
  // fiable URL→categoría aquí, así que nos limitamos a detectar y loguear.
  const { codigoDescuento, rebajasUrls } = await detectarRebajasYCodigoViaHtml(SITE_URL, SITE_URL)
  if (codigoDescuento) {
    console.log(`[misterpadel] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
  }
  if (rebajasUrls.length > 0) {
    console.log(`[misterpadel] sección(es) de rebajas detectada(s) (no scrapeada automáticamente): ${rebajasUrls.join(', ')}`)
  }

  const scraped_at = new Date().toISOString()
  let conCupon = 0
  const resultado = unique.map(p => {
    let pathname = null
    try { pathname = new URL(p.url).pathname } catch { /* url ya venía rara */ }
    const pctCarrito = pathname ? mapaCupones.get(pathname) : undefined

    if (pctCarrito) conCupon++

    return {
      source_key:      SOURCE_KEY,
      title:           p.title,
      price:           p.price,
      precio_original: p.precio_original ?? null,
      url:             p.url,
      image:           p.image ?? null,
      scraped_at,
      // Fix 2026-08-13: cupón automático de carrito, por producto (ver
      // scrapearDescuentosCarrito). Se aplica por producto y no como código
      // de tienda, porque el % varía por pala y no todas lo llevan.
      codigoDescuento: pctCarrito ? 'CUPON_CARRITO' : undefined,
      descuentoPct:    pctCarrito ?? undefined,
    }
  })
  console.log(`[misterpadel] ${conCupon}/${resultado.length} productos con cupón de carrito aplicado`)
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
