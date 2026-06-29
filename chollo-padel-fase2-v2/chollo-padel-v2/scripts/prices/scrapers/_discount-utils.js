// scripts/prices/scrapers/_discount-utils.js
//
// Detector generico de codigos de descuento extra (banners tipo "CODIGO:
// PADELMANIA10 -10% EXTRA") en el texto de una pagina ya descargada.
//
// Diseno deliberadamente conservador: exige DOS senales juntas en una
// ventana de texto corta - (1) un token asociado a la palabra
// "codigo"/"cupon" que sea INTEGRAMENTE MAYUSCULAS en el texto original
// (los codigos reales de tienda casi siempre se publicitan asi:
// PADELMANIA10, VERANO25, etc. - esto descarta frases normales que
// simplemente mencionan la palabra "codigo"), y (2) un porcentaje
// "-N%"/"N% extra" cerca de ese token - para no generar falsos positivos
// con texto de marketing generico.
//
// Validado 2026-06-28 contra HTML real (no inventado):
//   - padelmania.com  -> SI detecta: "-10% EXTRA EN TODA LA WEB POR TIEMPO
//     LIMITADO. CODIGO: PADELMANIA10" -> { codigo: 'PADELMANIA10', descuento_pct: 10 }
//   - stockpadel.com  -> NO detecta nada (no hay banner de codigo en esa
//     tienda ahora mismo) - confirma que el detector no fuerza falsos
//     positivos donde no hay cupon real.
//
// Uso previsto: scrapers que ya parsean HTML con cheerio le pasan el texto
// plano de la pagina (`$('body').text()`), NO el HTML crudo - asi se evita
// ruido de atributos/clases. Las tiendas API-only (Shopify JSON, WooCommerce
// Store API, Clerk.io) no descargan HTML como parte de su flujo normal de
// productos - para esas se usa el helper detectarRebajasYCodigoViaHtml() de
// mas abajo, que hace una peticion HTML adicional solo para alimentar este
// detector, sin tocar la extraccion de productos via API.

const VENTANA = 80 // caracteres de margen para buscar el % cerca del codigo
const VENTANA_EXCLUSION = 150 // margen mas amplio para detectar contexto de newsletter
const PALABRAS_GENERICAS = new Set([
  'DESCUENTO', 'EXTRA', 'OFERTA', 'OFERTAS', 'PROMOCION', 'PROMO', 'PADEL',
  'GRATIS', 'NUEVO', 'NUEVA', 'WEB',
])
// Banners de "suscribete a la newsletter y consigue X% con el codigo ..." son
// un patron habitual en Shopify/tiendas: el "codigo" mostrado suele ser
// generico/decorativo (el codigo real, si existe, se genera y se envia por
// email al suscribirte) - no es un codigo de caja operativo. Se descartan
// estas coincidencias para no reportar codigos que no funcionan en checkout.
const RE_CONTEXTO_NEWSLETTER = /newsletter|suscr[ií]bete|suscripci[oó]n|bolet[ií]n/i

function limpiarTexto(input) {
  if (!input) return ''
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
}

/**
 * @param {string} textoPagina texto plano de la pagina (p.ej. $('body').text())
 * @returns {{ codigo: string, descuento_pct: number } | null}
 */
function detectarCodigoDescuento(textoPagina) {
  const texto = limpiarTexto(textoPagina)
  if (!texto) return null

  const reCodigo = /(?:c[oó]digo|cup[oó]n)\s*:?\s*["']?\b([A-Za-z][A-Za-z0-9]{2,14})\b/gi
  let m
  while ((m = reCodigo.exec(texto)) !== null) {
    const codigo = m[1]
    if (codigo !== codigo.toUpperCase() || !/[A-Z]/.test(codigo)) continue
    if (PALABRAS_GENERICAS.has(codigo)) continue

    const inicio = Math.max(0, m.index - VENTANA)
    const fin = Math.min(texto.length, m.index + m[0].length + VENTANA)
    const entorno = texto.slice(inicio, fin)

    const mPct = entorno.match(/(\d{1,2})\s*%/)
    if (mPct) {
      const pct = parseInt(mPct[1], 10)
      if (pct > 0 && pct <= 50) {
        const inicioExcl = Math.max(0, m.index - VENTANA_EXCLUSION)
        const finExcl = Math.min(texto.length, m.index + m[0].length + VENTANA_EXCLUSION)
        const entornoExcl = texto.slice(inicioExcl, finExcl)
        if (RE_CONTEXTO_NEWSLETTER.test(entornoExcl)) continue

        return { codigo, descuento_pct: pct }
      }
    }
  }
  return null
}

// -----------------------------------------------------------------------
// Detector de secciones de "rebajas" no contempladas (URLs nuevas tipo
// /rebajas-verano-2026, /black-friday, /liquidacion) a partir de los
// enlaces <a href> que cada scraper ya tiene disponibles en su pagina 1
// (via DOM en Playwright/Puppeteer, o via cheerio/regex en scrapers de
// solo-HTML). No hace ninguna peticion de red por si misma - los
// scrapers son los que deciden si fetchear las URLs candidatas.
//
// Deliberadamente conservador: solo dispara con 3 palabras clave de alta
// precision en el PATH de la URL (no en el texto del enlace, que es mucho
// mas ruidoso) y excluye paginas administrativas (blog, legal, etc.) y
// cualquier URL ya conocida/usada por el scraper (BASE_URL, categorias
// existentes), para no generar falsos positivos ni re-scrapear lo mismo.
//
// Validado 2026-06-29 contra HTML real: padeliberico.es tiene un enlace
// de menu a https://www.padeliberico.es/rebajas-verano-2026 que NO esta
// en la lista de categorias que scrapea hoy padeliberico.js (que solo usa
// /palas-de-padel) - ese es el caso real que motiva este detector.

const REBAJAS_KEYWORDS = /rebajas|black-?friday|liquidacion/i
const REBAJAS_EXCLUDE_PATH = /\/(blog|content|aviso-legal|politica|condiciones|contactenos|mapa-del-sitio|opiniones|module)/i

function normalizarUrl(url, origin) {
  try {
    const u = new URL(url, origin || undefined)
    u.hash = ''
    let path = u.pathname.toLowerCase()
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
    return u.origin.toLowerCase() + path
  } catch {
    return String(url).toLowerCase()
  }
}

/**
 * @param {string[]} hrefs lista de hrefs (absolutos o relativos) ya extraidos por el scraper
 * @param {string} baseUrl URL base/categoria principal del scraper (se usa para resolver relativos y como exclusion)
 * @param {string[]} excludeUrls otras URLs ya conocidas/scrapeadas que no deben considerarse "nuevas"
 * @returns {string[]} URLs absolutas candidatas a sección de rebajas, unicas, sin las ya conocidas
 */
function filtrarUrlsRebajas(hrefs, baseUrl, excludeUrls = []) {
  if (!Array.isArray(hrefs) || hrefs.length === 0) return []

  let origin = null
  try { origin = baseUrl ? new URL(baseUrl).origin : null } catch { origin = null }

  const excludeSet = new Set(
    [...(baseUrl ? [baseUrl] : []), ...excludeUrls].map(u => normalizarUrl(u, origin))
  )

  const found = new Map()
  for (const raw of hrefs) {
    if (!raw || typeof raw !== 'string') continue

    let abs
    try { abs = new URL(raw, origin || undefined).toString() } catch { continue }

    if (!REBAJAS_KEYWORDS.test(abs)) continue
    if (REBAJAS_EXCLUDE_PATH.test(abs)) continue
    if (origin) {
      try { if (new URL(abs).origin.toLowerCase() !== origin.toLowerCase()) continue } catch { continue }
    }

    const key = normalizarUrl(abs, origin)
    if (excludeSet.has(key)) continue
    if (!found.has(key)) found.set(key, abs.split('#')[0])
  }

  return [...found.values()]
}

// -----------------------------------------------------------------------
// Helper para tiendas API-only (Shopify JSON, WooCommerce Store API,
// Clerk.io): estas tiendas no descargan HTML como parte de su flujo normal
// de extraccion de productos (todo via API JSON), asi que no tienen texto
// de pagina ni <a href> que pasarle a detectarCodigoDescuento/
// filtrarUrlsRebajas. Este helper hace UNA peticion HTTP adicional, de solo
// lectura, a una URL HTML (home o pagina de categoria) exclusivamente para
// alimentar esos dos detectores - nunca toca ni reemplaza la logica de
// extraccion de productos via API, que sigue exactamente igual. Disenado
// para no romper nunca el scrape: cualquier fallo de red o HTTP devuelve
// "nada detectado" en vez de lanzar excepcion.
//
// @param {string} url URL HTML a descargar (home o pagina de categoria)
// @param {string} [baseUrl] URL base para resolver relativos / exclusion (por defecto, url)
// @returns {Promise<{ codigoDescuento: {codigo:string,descuento_pct:number}|null, rebajasUrls: string[] }>}
async function detectarRebajasYCodigoViaHtml(url, baseUrl) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
    })
    if (!res.ok) return { codigoDescuento: null, rebajasUrls: [] }
    const html = await res.text()
    const codigoDescuento = detectarCodigoDescuento(html)
    const hrefs = Array.from(html.matchAll(/href="([^"]+)"/g)).map(m => m[1])
    const rebajasUrls = filtrarUrlsRebajas(hrefs, baseUrl || url)
    return { codigoDescuento, rebajasUrls }
  } catch {
    return { codigoDescuento: null, rebajasUrls: [] }
  }
}

module.exports = { detectarCodigoDescuento, filtrarUrlsRebajas, detectarRebajasYCodigoViaHtml }
