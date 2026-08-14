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
const CONCURRENCIA_CUPONES = 8 // fichas de producto en paralelo al comprobar el cupón

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'es-ES,es;q=0.9',
}

// Fix 2026-08-13/14: detectado por Patricia — la ficha de producto puede
// ofrecer un cupón de descuento específico de ese producto, que NO viene en
// la API de Clerk.io (esta solo trae price/list_price). El % varía por
// producto y no todos los productos lo llevan.
//
// Intento 1 (2026-08-13): leer el badge "- X% Extra en el Carrito" del
// LISTADO de categoría y cruzarlo por URL — incompleto, el sitio no pinta el
// badge en el listado para todos los productos que sí lo tienen en su ficha.
//
// Intento 2 (2026-08-14, root-cause real, verificado en vivo con
// Claude-in-Chrome contra la ficha real de Nox Ea10 Ventus Hybrid 12K Xtreme
// Red/Black): el texto "X% cupón aplicado en la cesta" que se usó como patrón
// NO existe en el HTML servidor — ese texto solo aparece tras marcar
// manualmente un checkbox en la página (AJAX a
// /load_ajax/load_coupon_products.php), es decir, es un cupón OPCIONAL que
// el comprador debe activar, no un descuento automático. El fetch() devolvía
// 0/198 porque el patrón buscado nunca estuvo en el HTML crudo.
//
// El texto que SÍ está en el HTML servidor (confirmado con fetch() real,
// sin JS) es distinto y con dos particularidades más:
//   1. El sitio usa entidades HTML con nombre en vez de tildes unicode:
//      "cup&oacute;n" (no "cupón"), "V&aacute;lido" (no "Válido").
//   2. El label es "Aplicar 10% cup&oacute;n de descuento ... V&aacute;lido
//      hasta el 24 agosto, 2026" — lleva fecha de caducidad explícita.
// Se comprueba la ficha de CADA producto directamente (cobertura 100%, ya
// que no todos los productos llevan este cupón) y se descarta si la fecha
// de "Válido hasta" ya pasó, por si el HTML quedase cacheado en algún CDN.
const MESES_ES = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
}

function parseFechaEs(texto) {
  // "24 agosto, 2026" → Date
  const m = texto.match(/(\d{1,2})\s+([a-zñáéíóú]+),?\s+(\d{4})/i)
  if (!m) return null
  const mes = MESES_ES[m[2].toLowerCase()]
  if (mes === undefined) return null
  return new Date(parseInt(m[3], 10), mes, parseInt(m[1], 10), 23, 59, 59)
}

// Fix 2026-08-14 (segunda vuelta): Patricia detectó que palas que antes SÍ
// llevaban cupón (ej. Babolat Technical Viper Juan Lebrón 2025 — la propia
// web muestra "Cupón Extra 15% / Compra al precio de € 129,12 / El código
// SALE26 se aplica automáticamente en el carrito") se estaban quedando sin
// descuento tras el fix anterior. Root cause: el sitio tiene DOS mecanismos
// de cupón por producto, mutuamente excluyentes, y solo se estaba mirando
// uno:
//   1. <div class="coupon_flag cart">  → cupón AUTOMÁTICO (se aplica solo,
//      sin acción del cliente), con código fijo compartido (ej. SALE26) y
//      el precio final ya calculado en un <script> inline
//      (var prezzoScontato = 129.12). Verificado en vivo: Clerk price
//      (151.90) × (1 - 15%) = 129.115 ≈ 129.12 — cuadra exacto.
//   2. <div class="coupon_flag product"> → cupón OPCIONAL, el cliente debe
//      marcar un checkbox en la ficha ("Aplicar 10% cupón de descuento"),
//      con fecha de caducidad ("Válido hasta el 24 agosto, 2026").
// Verificado con varios productos que cada ficha solo lleva UNO de los dos
// (nunca ambos a la vez). Se comprueba primero el automático (más relevante,
// el cliente lo recibe sin hacer nada) y si no existe, el opcional.
async function obtenerCuponProducto(url) {
  try {
    const res = await fetch(url, { headers: HEADERS })
    if (!res.ok) return null
    const html = await res.text()

    // 1) Cupón automático de carrito (prioritario)
    const mCart = html.match(/coupon_flag\s+cart[\s\S]{0,400}?ttl">Cup(?:&oacute;n|ón)\s+Extra\s+(\d{1,2})\s*%/i)
    if (mCart) {
      const codigoMatch = html.match(/code_coupon_text"[^>]*>([^<]+)</i)
      return { pct: parseInt(mCart[1], 10), codigo: codigoMatch ? codigoMatch[1].trim() : 'CUPON_CARRITO' }
    }

    // 2) Cupón opcional (checkbox), con caducidad
    const mOptIn = html.match(/Aplicar\s+(\d{1,2})\s*%\s*cup(?:&oacute;n|ón)\s+de\s+descuento[\s\S]{0,300}?V(?:&aacute;lido|álido)\s+hasta\s+el\s+([^<]+)</i)
    if (mOptIn) {
      const fechaValidez = parseFechaEs(mOptIn[2])
      if (fechaValidez && fechaValidez.getTime() < Date.now()) {
        console.log(`[misterpadel] Cupón opcional de ${url} caducado (válido hasta ${mOptIn[2].trim()}) — se descarta`)
        return null
      }
      return { pct: parseInt(mOptIn[1], 10), codigo: 'CUPON_PRODUCTO' }
    }

    return null
  } catch {
    return null
  }
}

async function scrapearDescuentosCarrito(urls) {
  const mapa = new Map() // url → { pct, codigo }
  let hechos = 0
  let cola = [...urls]

  async function worker() {
    while (cola.length > 0) {
      const url = cola.shift()
      if (!url) continue
      const resultado = await obtenerCuponProducto(url)
      if (resultado) mapa.set(url, resultado)
      hechos++
      if (hechos % 25 === 0) console.log(`[misterpadel] cupón por producto: ${hechos}/${urls.length} comprobados, ${mapa.size} con cupón`)
    }
  }

  const workers = Array.from({ length: CONCURRENCIA_CUPONES }, () => worker())
  await Promise.all(workers)

  console.log(`[misterpadel] cupón de carrito detectado en ${mapa.size}/${urls.length} productos`)
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

  // Comprobar el cupón de carrito en la propia ficha de cada producto (ver
  // obtenerCuponProducto/scrapearDescuentosCarrito) — cobertura 100%.
  const mapaCupones = await scrapearDescuentosCarrito(unique.map(p => p.url))

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
    const cupon = mapaCupones.get(p.url)

    if (cupon) conCupon++

    return {
      source_key:      SOURCE_KEY,
      title:           p.title,
      price:           p.price,
      precio_original: p.precio_original ?? null,
      url:             p.url,
      image:           p.image ?? null,
      scraped_at,
      // Fix 2026-08-13/14: cupón por producto (automático de carrito u
      // opcional por checkbox — ver obtenerCuponProducto). Se aplica por
      // producto y no como código de tienda, porque el % varía por pala y
      // no todas lo llevan.
      codigoDescuento: cupon ? cupon.codigo : undefined,
      descuentoPct:    cupon ? cupon.pct : undefined,
    }
  })
  console.log(`[misterpadel] ${conCupon}/${resultado.length} productos con cupón de carrito aplicado`)
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
