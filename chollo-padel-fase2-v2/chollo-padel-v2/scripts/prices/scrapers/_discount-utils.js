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
// ruido de atributos/clases. Las tiendas Shopify-JSON-only (futurapadelshop,
// justpadel, padelkiwi, padelmarket, starvie, tennispoint) no tienen HTML de
// pagina que escanear con este mecanismo: su JSON de producto no incluye
// banners promocionales, asi que NO se les aplica este detector.

const VENTANA = 80 // caracteres de margen para buscar el % cerca del codigo
const PALABRAS_GENERICAS = new Set([
  'DESCUENTO', 'EXTRA', 'OFERTA', 'OFERTAS', 'PROMOCION', 'PROMO', 'PADEL',
  'GRATIS', 'NUEVO', 'NUEVA', 'WEB',
])

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
        return { codigo, descuento_pct: pct }
      }
    }
  }
  return null
}

module.exports = { detectarCodigoDescuento }
