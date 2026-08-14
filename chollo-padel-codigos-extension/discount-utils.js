// chollo-padel-codigos-extension/discount-utils.js
//
// Puerto para el Service Worker (Chrome MV3) de
// chollo-padel-fase2-v2/chollo-padel-v2/scripts/prices/scrapers/_discount-utils.js
// (el detector de códigos de descuento). Misma lógica exacta, sin cambios —
// solo sin `module.exports`/`require` porque este fichero se carga con
// `importScripts()` dentro del Service Worker de la extensión, que comparte
// el scope global igual que config.js.

const VENTANA = 80 // caracteres de margen para buscar el % cerca del codigo
const VENTANA_EXCLUSION = 150 // margen mas amplio para detectar contexto de newsletter
const PALABRAS_GENERICAS = new Set([
  'DESCUENTO', 'EXTRA', 'OFERTA', 'OFERTAS', 'PROMOCION', 'PROMO', 'PADEL',
  'GRATIS', 'NUEVO', 'NUEVA', 'WEB', 'TARJETA', 'ENVIO', 'ENVIOS',
  'COMPRA', 'PRIMERA', 'BIENVENIDA',
  // Categorías de producto de tiendas de padel (falsos positivos habituales)
  'BOLSA', 'BOLSAS', 'CARRITO', 'PALA', 'PALAS', 'SALE',
  'PALETERO', 'PALETEROS', 'MOCHILA', 'MOCHILAS', 'ZAPATILLA', 'ZAPATILLAS',
  'ROPA', 'CAMISETA', 'CAMISETAS', 'POLO', 'POLOS', 'PANTALON', 'PANTALONES',
  'SUDADERA', 'SUDADERAS', 'CHALECO', 'CHALECOS', 'SHORT', 'SHORTS',
  'PELOTA', 'PELOTAS', 'GRIP', 'OVERGRIP', 'OUTLET', 'ACCESORIOS', 'ACCESORIO',
  'COMPLEMENTO', 'COMPLEMENTOS', 'FUNDA', 'FUNDAS', 'TROLLEY', 'TROLLEYS',
  'CALCETINES', 'MUNEQUERA', 'MUNEQUERAS', 'GORRA', 'GORRAS',
])
const RE_CONTEXTO_NEWSLETTER = /newsletter|suscr[ií]bete|suscripci[oó]n|bolet[ií]n/i

function limpiarTexto(input) {
  if (!input) return ''
  let attrText = ''
  const reAttr = /\s(?:data-[a-z][a-z0-9_-]*|alt|title|placeholder)\s*=\s*["']([^"'<>]{1,300})["']/gi
  let ma
  while ((ma = reAttr.exec(input)) !== null) attrText += ' ' + ma[1]

  return (input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    + attrText)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} textoPagina texto plano o HTML de la pagina
 * @returns {{ codigo: string, descuento_pct: number } | null}
 */
function detectarCodigoDescuento(textoPagina) {
  const texto = limpiarTexto(textoPagina)
  if (!texto) return null

  // --- PASO 1: keyword inmediatamente antes del codigo ----------------------
  const reCodigo = /\b(?:c[oó]digo|cup[oó]n|cod)\b\s*:?\s*["']?\b([A-Za-z][A-Za-z0-9]{2,14})\b/gi
  let m
  while ((m = reCodigo.exec(texto)) !== null) {
    const codigo = m[1]
    if (codigo !== codigo.toUpperCase() || !/[A-Z]/.test(codigo)) continue
    if (PALABRAS_GENERICAS.has(codigo)) continue

    const posFin = m.index + m[0].length
    const despues = texto.slice(posFin, Math.min(texto.length, posFin + VENTANA))
    const mDespues = despues.match(/(\d{1,2})\s*%/)
    const antes = texto.slice(Math.max(0, m.index - VENTANA), m.index)
    const todosAntes = [...antes.matchAll(/(\d{1,2})\s*%/g)]
    const mAntes = todosAntes.length > 0 ? todosAntes[todosAntes.length - 1] : null

    let mPct = null
    if (mAntes && mDespues) {
      const distAntes = antes.length - (mAntes.index + mAntes[0].length)
      const distDespues = mDespues.index
      mPct = distAntes <= distDespues ? mAntes : mDespues
    } else {
      mPct = mDespues || mAntes
    }
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

  // --- PASO 2: keyword -> % entre medio -> codigo ---------------------------
  const reKwPct = /\b(?:c[oó]digo|cup[oó]n|cod)\b.{0,15}?(\d{1,2})\s*%([^.!?\n]{0,60})/gi
  while ((m = reKwPct.exec(texto)) !== null) {
    const pct = parseInt(m[1], 10)
    if (pct <= 0 || pct > 50) continue

    const ventana = m[2]
    const tokens = ventana.match(/\b[A-Z][A-Z0-9]{2,14}\b/g) || []
    for (const codigo of tokens) {
      if (PALABRAS_GENERICAS.has(codigo)) continue

      const inicioExcl = Math.max(0, m.index - VENTANA_EXCLUSION)
      const finExcl = Math.min(texto.length, m.index + m[0].length + VENTANA_EXCLUSION)
      if (RE_CONTEXTO_NEWSLETTER.test(texto.slice(inicioExcl, finExcl))) continue

      return { codigo, descuento_pct: pct }
    }
  }

  // --- PASO 3: N% ... con CODIGO (sin keyword explicito) --------------------
  const rePctCon = /\b(\d{1,2})\s*%[^.!?\n]{0,30}\bcon\s+([A-Z][A-Z0-9]{2,14})\b/gi
  while ((m = rePctCon.exec(texto)) !== null) {
    const pct = parseInt(m[1], 10)
    const codigo = m[2]
    if (pct <= 0 || pct > 50) continue
    if (PALABRAS_GENERICAS.has(codigo)) continue

    const inicioExcl = Math.max(0, m.index - VENTANA_EXCLUSION)
    const finExcl = Math.min(texto.length, m.index + m[0].length + VENTANA_EXCLUSION)
    if (RE_CONTEXTO_NEWSLETTER.test(texto.slice(inicioExcl, finExcl))) continue

    return { codigo, descuento_pct: pct }
  }

  return null
}
