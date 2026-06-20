/**
 * scripts/pipeline-tiendas.ts
 * =============================================================================
 * Pipeline de precios de tiendas con nueva estrategia de matching por atributos.
 *
 * Flujo por producto:
 *   1. Buscar texto normalizado en producto_aliases → match directo (cache)
 *   2. Extraer atributos → buscar en palas por (marca, linea, modelo, variante, año)
 *      → match único  → price_snapshot + nuevo alias
 *      → ambiguo      → palas_candidatas para revisión manual (Gestor)
 *      → sin match    → palas_candidatas para revisión manual (Gestor)
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/pipeline-tiendas.ts padelnuestro
 *   npx tsx --env-file=.env.local scripts/pipeline-tiendas.ts padelnuestro --dry-run
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js'
import { extraerAtributos, normalizar, cargarLineasDesdeBD } from './extract-atributos'
import { main as postPipeline } from './post-pipeline.ts'

// Interfaz explícita para evitar que ts-node falle con ReturnType<> sobre props con ñ
interface AtributosExtraidos {
  marca:    string | null
  linea:    string | null
  modelo:   string | null
  variante: string | null
  // eslint-disable-next-line @typescript-eslint/naming-convention
  año:      number | null
}

// Cargar .env.local si existe (entorno local). En CI las vars vienen del entorno del runner.
try { require('dotenv').config({ path: '.env.local' }) } catch (_) {}

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const TIENDA  = process.argv[2]
const DRY_RUN  = process.argv.includes('--dry-run')
const NO_POST   = process.argv.includes('--no-post')

if (!TIENDA) {
  console.error('❌ Uso: npx tsx pipeline-tiendas.ts <tienda> [--dry-run]')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

// ─── Helpers BD ──────────────────────────────────────────────────────────────

async function getSourceId(slug: string): Promise<string> {
  const { data, error } = await supabase
    .from('price_sources')
    .select('id')
    .eq('slug', slug)
    .single()
  if (error || !data) throw new Error(`Tienda no encontrada en price_sources: ${slug}`)
  return data.id
}

async function buscarPorAlias(textoNorm: string): Promise<string | null> {
  // Usamos .limit(1) en lugar de .maybeSingle() porque el mismo texto puede estar
  // aliaseado en varias tiendas (texto_normalizado no es unique solo — la clave única
  // es (tienda, texto_normalizado)). Con maybeSingle(), si hay >1 fila devuelve null
  // y el alias lookup falla silenciosamente aunque el alias exista.
  const { data } = await supabase
    .from('producto_aliases')
    .select('pala_id')
    .eq('texto_normalizado', textoNorm)
    .limit(1)
  return data?.[0]?.pala_id ?? null
}

// Traduce la variante a una forma común para comparar candidata vs catálogo,
// sin importar si está escrita "CTRL" o "CONTROL" (mismo significado, distinta palabra).
// OJO: esta tabla es una lista cerrada y controlada — solo se añaden pares aquí
// cuando se ha confirmado que significan EXACTAMENTE lo mismo (ver caso Light/Lite,
// que demostró que no todas las abreviaturas son intercambiables).
const LINEA_EQUIVALENCIAS: Record<string, string> = {
  'jr': 'Junior',
  'copa del mundo': 'World Cup',
  'world cup': 'World Cup',
}

function normalizarLinea(l: string | null): string | null {
  if (!l) return null
  const norm = l.toLowerCase().trim()
  return LINEA_EQUIVALENCIAS[norm] ?? l
}

const VARIANTE_EQUIVALENCIAS: Record<string, string> = {
  'paises bajos': 'netherlands',
  'estados unidos': 'usa',
  'control': 'ctrl', 'ctrl': 'ctrl', 'ctr': 'ctrl',
  'hybrid': 'hybrid', 'hyb': 'hybrid',
  'power': 'power', 'pwr': 'power',
  'xtrem': 'xtrem', 'xtreme': 'xtrem',
  'cmf': 'comfort',
  'wpt': 'world padel tour', 'world padel tour': 'world padel tour',
}

function normalizarVariante(v: string | null): string | null {
  if (!v) return null
  const norm = v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  return VARIANTE_EQUIVALENCIAS[norm] ?? norm
}

// Tokens que, si aparecen en el catálogo pero no en lo extraído, indican un producto
// distinto (no solo "especificación adicional"). Impide que "3.4" matchee "CTRL 3.4"
// o que "Cross It" matchee "Cross It Team" cuando la tienda no menciona Team.
// Regla: "Genius 12K" ⊆ "Genius 12K Alum" → extra='alum' → no discriminante → OK.
//        "3.4" ⊆ "CTRL 3.4"               → extra='ctrl' → discriminante → NO match.
const MODELO_DISCRIMINANTES = new Set([
  'ctrl', 'control', 'team', 'hybrid', 'air', 'carbon', 'light',
  'plus', 'elite', 'power', 'soft', 'iron', 'speed', 'hard', 'free',
  'betis', 'miami',
  'se',      // Wilson Special Edition
  'gen',     // LOK Gen 1/2/3
  'cloud',   // Bullpadel Cloud variants
  'geo',     // Bullpadel GEO series
  'premier', // Bullpadel Premier Padel edition
  'energy',  // StarVie Energy / Nox Energy variants
  'luxury',  // Nox Luxury / StarVie Luxury variants
  'black',   // Siux Fenix 5 vs 5 Black
  // NOTA 2026-06-20: se probó añadir TODOS los colores aquí como discriminante
  // universal para resolver ambiguos por variante de color (Wilson Blade V4 LS
  // Rosa, Babolat Lamborghini Azul, etc). Revertido: rompía el caso contrario
  // —catálogo con una sola fila que tiene el color metido en "modelo" y la
  // tienda no menciona color— convirtiendo un match único correcto en
  // sin_match (verificado en dry-run: sin_match subió 635→692, por_atributos
  // bajó 1187→1141). La desambiguación por color real vive en
  // resolverAmbiguosPorColor(), aplicada solo cuando ya hay >1 candidato.
  'ls',      // Wilson Blade LS vs Blade, Defy LS vs Defy
  'prisma',  // Varlion LW Prisma vs LW
  'pansy',   // Varlion Prisma Pansy vs Prisma
  'world',   // Lok Hype World vs Hype
  'lite',    // Nox AT10 Genius 12K Alum Xtrem vs ...Xtrem LITE (variante más ligera,
             // NO la misma pala) — sin esto, "lite" como extra no discriminaba y
             // contaminó aliases/price_snapshots de dos pala_id distintos (detectado
             // en BD, no reproducido aún en pipeline real, pero el hueco existía).
])

// Marcas que no están (ni se van a dar de alta) en el catálogo `palas` y que generan
// ruido constante en "Pendientes que requieren revisión manual" (estado sin_match,
// marca_detectada=null). En vez de crear una candidata para que el Gestor las descarte
// a mano cada vez, se descartan aquí directamente antes de insertarCandidata().
// Revisar y quitar de esta lista si en el futuro se decide dar soporte a alguna.
// Nota: "wing[ -]?padel" porque las tiendas escriben tanto "WINGPADEL" (una palabra)
// como "WING PADEL" / "WING-PADEL" (separado) seg\u00fan el producto.
const MARCAS_EXCLUIDAS = [
  'ares', 'eclypse', 'leyenda', 'orygen', 'wing[ -]?padel', 'pala set', 'kugan', 'dreampadel',
]

function tituloTieneMarcaExcluida(titulo: string): boolean {
  const norm = titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return MARCAS_EXCLUIDAS.some(m => new RegExp(`\\b${m}\\b`, 'i').test(norm))
}

// Devuelve true si los tokens del modelo extraído son todos subconjunto del modelo
// del catálogo, o viceversa. Permite matchear "GENIUS 12K" con "Genius 12K Alum":
// la tienda omitió "Alum" pero no contradice el catálogo.
// Si no hay modelo extraído → no filtramos por modelo (cualquier modelo vale).

// Dos tokens son "compatibles" si son iguales o difieren solo en 1 carácter final
// (e.g., "xtrem"/"xtreme"). Solo aplica a tokens >=4 chars.
function tokensCompatibles(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 4 || b.length < 4) return false
  if (Math.abs(a.length - b.length) === 1) return a.startsWith(b) || b.startsWith(a)
  return false
}

function tokenIn(t: string, arr: string[]): boolean {
  return arr.some(x => tokensCompatibles(t, x))
}

// Colores ya traducidos a inglés (ver MODELO_TOKEN_ALIAS). Usados SOLO para
// desambiguar candidatos ya-ambiguos en resolverAmbiguosPorColor() — no son
// discriminantes universales en modeloCompatible() (eso causó una regresión
// real el 2026-06-20: sin_match 635→692 porque rompía el caso de una sola
// fila de catálogo con el color metido en "modelo" y la tienda sin mencionar color).
const COLORES = new Set([
  'black', 'white', 'red', 'green', 'yellow', 'blue',
  'grey', 'orange', 'pink', 'silver', 'gold', 'purple', 'brown',
])

function tokensDeModelo(s: string | null): string[] {
  if (!s) return []
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean)
    .map(t => MODELO_TOKEN_ALIAS[t] ?? t)
}

function colorDeModelo(s: string | null): string | null {
  return tokensDeModelo(s).find(t => COLORES.has(t)) ?? null
}

function modeloSinColor(s: string | null): string {
  return tokensDeModelo(s).filter(t => !COLORES.has(t)).join(' ')
}

// Desambigua candidatos que ya pasaron buscarPorAtributos cuando la única
// diferencia entre ellos es el color (metido dentro de "modelo" por
// inconsistencia de import, ej. "LS V4" vs "LS V4 ROSA"). Si la tienda
// menciona un color explícito, nos quedamos con la fila de ese color. Si no
// menciona ninguno, preferimos la fila "base" sin color en modelo (si hay
// exactamente una). Casos reales: Wilson Blade V4 LS Rosa, Babolat Lamborghini
// Azul 2026, Head Bolt Rojo Negro 2026, Adidas Arrow Hit Hexagon Cup 2026.
function resolverAmbiguosPorColor<T extends { marca: string | null; linea: string | null; modelo: string | null; variante: string | null; año: number | null }>(
  candidatos: T[], modeloExtraido: string | null,
): T[] {
  if (candidatos.length <= 1) return candidatos
  const clave = (p: T) =>
    `${(p.marca ?? '').toLowerCase()}|${(p.linea ?? '').toLowerCase()}|${normalizarVariante(p.variante) ?? ''}|${p.año ?? ''}|${modeloSinColor(p.modelo)}`
  if (new Set(candidatos.map(clave)).size !== 1) return candidatos // difieren en algo más que color → seguir ambiguos

  const colorTienda = colorDeModelo(modeloExtraido)
  if (colorTienda) {
    const exacto = candidatos.filter(p => colorDeModelo(p.modelo) === colorTienda)
    if (exacto.length === 1) return exacto
  } else {
    const sinColor = candidatos.filter(p => colorDeModelo(p.modelo) === null)
    if (sinColor.length === 1) return sinColor
  }
  return candidatos
}

// Aliases de tokens de modelo: normaliza abreviaturas a su forma canónica.
// Permite que "MTW" (abreviatura de Adidas) matchee con "Multiweight".
const MODELO_TOKEN_ALIAS: Record<string, string> = {
  'mtw': 'multiweight',
  // Traducciones de color español→inglés (tiendas ES usan español, BD usa inglés)
  'negra': 'black', 'negro': 'black',
  'blanca': 'white', 'blanco': 'white',
  'roja': 'red', 'rojo': 'red',
  'verde': 'green',
  'amarilla': 'yellow', 'amarillo': 'yellow',
  'azul': 'blue',
  'gris': 'grey',
  'naranja': 'orange',
  'rosa': 'pink',
  'plata': 'silver', 'plateado': 'silver', 'plateada': 'silver',
  'oro': 'gold', 'dorado': 'gold', 'dorada': 'gold',
  'morado': 'purple', 'morada': 'purple', 'lila': 'purple', 'violeta': 'purple',
  'marron': 'brown', 'marrón': 'brown',
  // Abreviaturas de color en inglés (tiendas usan Bk/Bl/Rd/Wh/Yl)
  'bk': 'black',
  'bl': 'blue',
  'rd': 'red',
  'wh': 'white',
  'yl': 'yellow',
}

function modeloCompatible(
  modeloCat: string | null, modeloExtraido: string | null,
  añoCat: number | null = null, añoExtraido: number | null = null,
): boolean {
  // Si la tienda no especifica modelo → solo matchea palas que tampoco tienen modelo.
  // "CROSS IT CTRL" no debe ir a "Cross It Team CTRL" solo porque Team no se menciona.
  if (!modeloExtraido) {
    if (!modeloCat) return true
    // Si el catálogo tiene solo un número de versión ("3.3", "3.4") y el extractor
    // no tiene modelo (porque el 3.x fue convertido a año) → compatible; el año discrimina.
    return /^[\d.]+$/.test(modeloCat.trim())
  }
  const tokenizar = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      // Fusionar versiones "X.Y" en un solo token ANTES de partir por puntuaci\u00f3n.
      // Sin esto, "3.3" \u2192 tokens ['3','3'] y "3.0" \u2192 ['3','0']: el '0'/'3' suelto
      // no est\u00e1 en MODELO_DISCRIMINANTES (solo tiene palabras) y el algoritmo los
      // trataba como compatibles por compartir el '3' \u2014 falso positivo real:
      // "Adidas Adipower CTRL 3.0" (streetpadel) matche\u00f3 con "Adidas Adipower 3.3 CTRL".
      .replace(/\b(\d+)\.(\d+)\b/g, '$1$2')
      .replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean)
      .map(t => MODELO_TOKEN_ALIAS[t] ?? t)
  // Catalogo sin modelo (modeloCat=null, ej. "SOFTEE TRIONIC" sin sufijo) se trata
  // como tokens=[] en vez de cortar aqui con un caso especial: asi el extra de la
  // tienda (modeloExtraido) pasa por el mismo filtro esExtraInseguro() de abajo -
  // ruido real (colores, "Yellow", "Wmn"...) no discrimina, pero un numero de
  // version SIN ano en ningun lado sigue discriminando igual que en el resto de
  // casos. Bug real 2026-06-20: "Pala Softee Trionic Yellow 2025" caia en
  // sin_match contra la fila plana "SOFTEE TRIONIC" porque el caso especial
  // anterior solo aceptaba modelo puramente numerico y rechazaba cualquier otra
  // cosa, aunque fuera ruido inofensivo.
  const tCat = modeloCat ? tokenizar(modeloCat) : []
  const tExt = tokenizar(modeloExtraido)
  // Un token extra puramente numérico (ej. "32" fusionado de "3.2") solo es seguro
  // de ignorar si el año discrimina realmente en alguno de los dos lados. Si NO hay
  // año conocido en ninguno de los dos, ese número es la ÚNICA pista de versión que
  // tenemos y SÍ debe discriminar — caso real: tienda "Pala adidas Metalbone Youth 3.4"
  // (sin año) matcheó contra catálogo "Youth 3.2" porque el "2" sobrante no contaba
  // como discriminante y no había año de ningún lado para frenarlo.
  // Un token "vXpY" (fusión de versión "X.Y", ej. "1.0"→"v1p0") es SIEMPRE
  // discriminante — nunca ruido ignorable. Bug real: "Drop Shot Canyon Pro
  // Control 1.0" matcheaba contra catálogo "Pro" (sin número, variante Control,
  // 2024 Y 2025) porque "v1p0" no pasaba ni MODELO_DISCRIMINANTES ni el test
  // de numérico puro (tiene letras v/p) → no se consideraba inseguro → 3 candidatos
  // ambiguos en vez de 1 (solo "Pro 1.0" CTRL 2025).
  const esExtraInseguro = (t: string) =>
    MODELO_DISCRIMINANTES.has(t) || /^v\d+p\d+$/.test(t) || (/^[0-9]+$/.test(t) && añoCat == null && añoExtraido == null)
  // Caso 1: tienda omite palabras (e.g., "GENIUS 12K" subset "Genius 12K Alum")
  // Solo permitido si las palabras extra del catálogo no son discriminantes.
  if (tExt.every(t => tokenIn(t, tCat))) {
    const extra = tCat.filter(t => !tokenIn(t, tExt))
    return !extra.some(esExtraInseguro)
  }
  // Caso 2: tienda añade palabras (catálogo subset tienda)
  if (tCat.every(t => tokenIn(t, tExt))) {
    const extra = tExt.filter(t => !tokenIn(t, tCat))
    return !extra.some(esExtraInseguro)
  }
  return false
}

async function buscarPorAtributos(attrs: AtributosExtraidos): Promise<{ id: string }[]> {
  if (!attrs.marca || !attrs.linea) return []

  let q = supabase
    .from('palas')
    .select('id, nombre, marca, linea, modelo, variante, año')
    .eq('marca', attrs.marca)
    .eq('linea', normalizarLinea(attrs.linea))

  // OJO: NO filtramos modelo en SQL — usamos match por subconjunto de tokens en
  // memoria (ver modeloCompatible). Motivo: algunas tiendas escriben "GENIUS 12K"
  // donde el catálogo tiene "Genius 12K Alum". Un ilike exacto los trataría como
  // productos distintos y crearía una fila duplicada.

  // OJO: NO filtramos por año en la consulta SQL. Si lo hiciéramos con
  // `.eq('año', attrs.año)`, cualquier pala ya existente con año=null quedaría
  // excluida aunque sea el mismo producto (caso real: "Siux Electra Lite ST3" -
  // Padelful trae año=2023, Padelzoom no informa año → se creó una fila duplicada
  // porque el filtro SQL descartó la fila sin año). Filtramos el año en memoria,
  // tratando "sin año" como comodín compatible con cualquier año.

  const { data: _rawData } = await q
  // Supabase type inference falla con 'ñ' en el nombre de columna ('año').
  // Cast explícito para evitar ParserError<"Unexpected input: ño">.
  const data = (_rawData ?? []) as unknown as {
    id: string; nombre: string; marca: string | null
    linea: string | null; modelo: string | null
    variante: string | null; año: number | null
  }[]
  // Comparamos variante "traducida" en memoria (CTRL == CONTROL, etc.) en vez de
  // comparar el string literal — evita falsos "sin match" por convenciones distintas
  // entre cómo lo escribe la tienda y cómo está guardado en el catálogo.
  const filtrados = (data ?? []).filter(p => {
    const variantesCoinciden = normalizarVariante(p.variante) === normalizarVariante(attrs.variante)
    // Año compatible si coinciden, o si a alguno de los dos lados le falta el dato
    const añoCompatible = !attrs.año || !p.año || p.año === attrs.año
    // Modelo compatible si los tokens del extraído son subconjunto del catálogo o viceversa.
    // Permite que "GENIUS 12K" (tienda) matchee con "Genius 12K Alum" (catálogo).
    const modeloOk = modeloCompatible(p.modelo, attrs.modelo, p.año, attrs.año)
    // Caso cruzado: extractor clasifica algo como variante pero el catálogo lo tiene como modelo
    // (ej: Bullpadel Indiga CTRL 2026 → attrs.variante="CTRL" pero DB tiene modelo="CTR", variante=null)
    const cruzado = !attrs.modelo && !!attrs.variante && !p.variante
      && normalizarVariante(p.modelo) === normalizarVariante(attrs.variante)
    return (variantesCoinciden && modeloOk || cruzado) && añoCompatible
  })

  // "Sin año" auto-resolución:
  // Si el título no lleva año y hay varios candidatos que solo difieren en año
  // → elegir el más reciente. Razonamiento: cuando una tienda lista "WILSON BELA V3"
  // sin año está vendiendo la versión actual, que es la más reciente del catálogo.
  // Solo activamos la regla si todos los candidatos comparten marca+linea+modelo+variante
  // (diferencia ÚNICAMENTE en año). Si difieren en otro campo, seguimos siendo
  // ambiguos — no queremos falsos positivos.
  if (!attrs.año && filtrados.length > 1) {
    const claveSinAño = (p: any) =>
      `${(p.marca ?? '').toLowerCase()}|${(p.linea ?? '').toLowerCase()}|${(p.modelo ?? '').toLowerCase()}|${normalizarVariante(p.variante) ?? ''}`
    const claves = new Set(filtrados.map(claveSinAño))
    if (claves.size === 1) {
      // Todos iguales salvo año → quedarse con el de mayor año
      const masReciente = filtrados.reduce((best: any, p: any) =>
        (p.año ?? 0) > (best.año ?? 0) ? p : best
      )
      return [masReciente]
    }
  }

  return resolverAmbiguosPorColor(filtrados, attrs.modelo)
}
// Devuelve true si el snapshot quedó guardado (o estamos en DRY_RUN), false si falló
// de verdad. OJO: antes esta función no devolvía nada — solo hacía console.error y
// seguía. Eso provocaba un bug real: si el insert fallaba (transitorio o no), el
// llamador igualmente ejecutaba insertarAlias() justo después, creando un alias
// "confirmado" para una pala que en realidad NUNCA quedó con precio guardado
// (caso real: "BULLPADEL VERTEX 04 25 WOMEN" en latiendadelpadel — alias creado,
// snapshot inexistente). Ahora se reintenta una vez (por si es un fallo de red
// puntual) y el resultado se propaga para que el llamador NO cree el alias si el
// snapshot de verdad falló.
async function insertarSnapshot(palaId: string, sourceId: string, producto: {
  precio: number; precioOriginal?: number; url: string; titulo: string
}): Promise<boolean> {
  if (DRY_RUN) return true
  const payload = {
    pala_id:          palaId,
    source_id:        sourceId,
    precio:           producto.precio,
    precio_original:  producto.precioOriginal ?? null,
    url_producto:     producto.url,
    match_confidence: 1.0,
    disponible:       true,
    scraped_at:       new Date().toISOString(),
  }
  for (let intento = 1; intento <= 2; intento++) {
    const { error } = await supabase.from('price_snapshots')
      .upsert(payload, { onConflict: 'pala_id,source_id' })
    if (!error) return true
    if (intento === 1) {
      console.error(`  ⚠️  [snapshot] ${producto.titulo}: ${error.message} — reintentando…`)
      await new Promise(r => setTimeout(r, 1000))
    } else {
      console.error(`  ❌ [snapshot] ${producto.titulo}: ${error.message} (tras reintento, NO se crea alias)`)
    }
  }
  return false
}

async function actualizarImagenSiNull(palaId: string, imageUrl: string | null | undefined) {
  if (DRY_RUN || !imageUrl) return
  // Solo actualiza si imagen_url es NULL — no pisa imágenes ya existentes
  await supabase.from('palas')
    .update({ imagen_url: imageUrl })
    .eq('id', palaId)
    .is('imagen_url', null)
}

async function insertarAlias(palaId: string, textoOriginal: string, tienda: string, url?: string) {
  if (DRY_RUN) return
  await supabase.from('producto_aliases').upsert({
    pala_id:           palaId,
    texto_original:    textoOriginal,
    texto_normalizado: normalizar(textoOriginal),
    tienda,
    fuente_url:        url ?? null,
    confianza:         1.0,
  }, { onConflict: 'tienda,texto_normalizado', ignoreDuplicates: true })
}

async function insertarCandidata(producto: {
  titulo: string; precio: number; url: string; tienda: string; imagen?: string | null
}, motivo: 'sin_match' | 'ambiguo', attrs: AtributosExtraidos, candidatos?: { id: string }[]): Promise<boolean> {
  if (DRY_RUN) return true
  if (tituloTieneMarcaExcluida(producto.titulo)) return false

  // "Borrador de pala" con todo lo extraído en el momento del scrap, para que
  // al promocionar la candidata se pueda crear la pala sin volver a investigar.
  const datosExtraidos = {
    marca:           attrs.marca,
    linea:           attrs.linea,
    modelo:          attrs.modelo,
    variante:        attrs.variante,
    año:             attrs.año,
    imagen_url:      producto.imagen ?? null,
    precio_pvp:      producto.precio,
    fuente:          producto.tienda,
    url_origen:      producto.url,
    candidatos_ids:  (candidatos ?? []).map(c => c.id),
    extraido_at:     new Date().toISOString(),
  }

  // No pisar candidatas ya resueltas — si estado='matched', la pala ya existe.
  // Si forzamos estado='pendiente' encima, el gestor la vuelve a mostrar como pendiente.
  const { data: existente } = await supabase
    .from('palas_candidatas')
    .select('id, estado')
    .eq('titulo_normalizado', normalizar(producto.titulo))
    .maybeSingle()
  if (existente?.estado === 'matched' || existente?.estado === 'ignorada') return false

  await supabase.from('palas_candidatas').upsert({
    titulo:             producto.titulo,
    titulo_normalizado: normalizar(producto.titulo),
    marca_detectada:    attrs.marca,
    precio_min:         producto.precio,
    precio_max:         producto.precio,
    fuentes:            [producto.tienda],
    urls:               [producto.url],
    estado:             motivo === 'ambiguo' ? 'ambiguo' : 'pendiente',
    datos_extraidos:    datosExtraidos,
    updated_at:         new Date().toISOString(),
  }, { onConflict: 'titulo_normalizado', ignoreDuplicates: false })
  return true
}

// ─── Scraper ─────────────────────────────────────────────────────────────────

// Algunas tiendas WooCommerce (Store API: latiendadelpadel, padelstyle, misterpadel,
// smashinn...) devuelven el campo "name" SIN decodificar entidades HTML — ej. el
// guion "–" de "Bullpadel XPLO 2026 – Di Nenno" llega literalmente como "&#8211;".
// Esa cadena nunca matchea el regex de guiones especiales de extraerAtributos(),
// asi que el residuo "8211" contamina el modelo y el producto cae en sin_match
// aunque la pala SI exista en catalogo. Se decodifica de forma centralizada aqui
// para que cualquier scraper -actual o futuro- quede protegido sin tener que
// arreglarlo tienda por tienda.
const ENTIDADES_HTML: Record<string, string> = {
  'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'",
  'nbsp': ' ', 'hellip': '…', 'rsquo': '’', 'lsquo': '‘',
  'rdquo': '”', 'ldquo': '“', 'mdash': '—', 'ndash': '–',
}
function decodeHtmlEntities(texto: string): string {
  if (!texto) return texto
  return texto
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, nombre) => ENTIDADES_HTML[nombre] ?? m)
}

async function scrape(tienda: string): Promise<{ title: string; price: number; precio_original?: number; url: string; image?: string | null }[]> {
  const scraper = require(`./prices/scrapers/${tienda}.js`)
  const productos = scraper.scrape ? await scraper.scrape() : await scraper()
  return productos.map((p: any) => ({ ...p, title: decodeHtmlEntities(p.title) }))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🏓 HUNTPADEL — Pipeline tiendas: ${TIENDA}`)
  console.log(`📅 ${new Date().toISOString()}`)
  if (DRY_RUN) console.log('🔍 DRY-RUN — no se escribe en BD\n')

  // 1. Obtener source_id de la tienda (en dry-run no se necesita escribir en BD)
  const sourceId = DRY_RUN ? 'dry-run' : await getSourceId(TIENDA)
  if (!DRY_RUN) console.log(`✅ Tienda encontrada: ${TIENDA} (id: ${sourceId})`)

  // 1b. Cargar lineas desde BD (sincroniza LINEAS_POR_MARCA automaticamente)
  await cargarLineasDesdeBD(supabase)

  // 2. Scrape
  console.log(`\n📥 Scrapeando ${TIENDA}...`)
  const productos = await scrape(TIENDA)
  console.log(`  → ${productos.length} productos`)

  // 3. Matching
  let porAlias = 0, porAtributos = 0, ambiguos = 0, sinMatch = 0, snapshotsFallidos = 0
  const titulosProcessed = new Set<string>()

  // Prefijos que indican que NO es una pala individual
  const EXCLUIR_PREFIJOS = ['pack ', 'super pack ', 'pala test ', 'bolso ', 'accesorio ', 'pala de padel open']
  // Marcas que no queremos trackear (entrenamiento, marcas residuales, etc.)
  const EXCLUIR_MARCAS = [
    'paddle coach', 'just ten',
    // Marcas muy nicho sin precio de referencia en otras tiendas → nunca serían chollos
    'hbl ', 'higer padel', 'hybrid padel', 'middle moon', 'nexus ', 'spin max', 'totalspin',
    'rox ', 'rs ', 'rs by robin', 'rs prime', 'robin soderling',
    'erreesse', 'pala erreesse', 'lx ', 'pala lx ',
    'sane ', 'pala sane ', 'pala rs ',
    'aca padel', 'aca atrium', 'aca magic', 'aca roqueta', 'aca wave', 'aca palladium',
    'pala aca ', 'set platinum',
    'kelme ', 'belén berbel', 'belen berbel', 'wild bull',
  ]

  // Marcas que el extractor SÍ reconoce (están en MARCAS de extract-atributos.ts)
  // pero que no tienen ninguna pala en el catálogo `palas` ni se van a dar de alta
  // (gama baja / nicho sin presencia real en el mercado de referencia). Sin esto,
  // cada producto de estas marcas cae siempre en "sin_match" o "ambiguo" y genera
  // candidatas en el Gestor que se descartan a mano una y otra vez (confirmado en
  // dry-run 20260619: HBL, Goliat, Cartri, Alacran, Kelme, Endless, Stiga, Osaka,
  // Indian Maharadja, By VP, Tactical, Hirostar, Xcalion).
  // A diferencia de EXCLUIR_MARCAS (startsWith, para casos muy concretos), esta
  // usa \b en cualquier posición del título porque estas marcas aparecen tanto al
  // principio ("Cartri Shooter 512º") como detrás de "Pala " ("Pala HBL Strike").
  // Revisar y quitar de aquí si en el futuro se decide dar soporte a alguna.
  // Ampliado 20260619 (2ª pasada, análisis "sin marca detectada" del dry-run):
  // Armani EA7, Fila, Rox, Salming, Prokennex, Hybrid, BB Zeus, EQSI, Futura, Set
  // → confirmado por SQL que ninguna tiene filas en `palas`.
  const MARCAS_NO_CATALOGADAS = [
    'hbl', 'goliat', 'cartri', 'alacran', 'kelme', 'endless', 'stiga', 'osaka',
    'indian maharadja', 'maharadja', 'by vp', 'tactical', 'hirostar', 'xcalion',
    'armani ea7', 'ea7', 'fila', 'salming', 'prokennex', 'bb zeus', 'eqsi', 'futura',
    // 'rox' y 'hybrid' ya cubiertas como prefijo en EXCLUIR_MARCAS ('rox ', 'hybrid padel');
    // 'set' se deja fuera de aquí por ser demasiado genérica (falsos positivos con "set platinum").
  ]
  function tituloTieneMarcaNoCatalogada(tituloLow: string): boolean {
    return MARCAS_NO_CATALOGADAS.some(m => new RegExp(`\\b${m}\\b`, 'i').test(tituloLow))
  }

  for (const p of productos) {
    const tituloLow = p.title.toLowerCase()
    if (EXCLUIR_PREFIJOS.some(pref => tituloLow.startsWith(pref))) {
      if (DRY_RUN) console.log(`  🚫 [excluido] ${p.title}`)
      continue
    }
    if (EXCLUIR_MARCAS.some(m => tituloLow.startsWith(m))) {
      if (DRY_RUN) console.log(`  🚫 [excluido] ${p.title}`)
      continue
    }
    if (tituloTieneMarcaNoCatalogada(tituloLow)) {
      if (DRY_RUN) console.log(`  🚫 [marca no catalogada] ${p.title}`)
      continue
    }
    if (tituloLow.includes('exclusiva padelproshop') || tituloLow.includes('(exclusiva padelproshop)')) {
      if (DRY_RUN) console.log(`  🚫 [excluido] ${p.title}`)
      continue
    }
    if (/ kit(\b|$)/.test(tituloLow) || / pack(\b|$)/.test(tituloLow) || /\btest\b/.test(tituloLow)) {
      if (DRY_RUN) console.log(`  🚫 [excluido kit/pack/test] ${p.title}`)
      continue
    }
    if (tituloLow.includes('pickleball')) {
      if (DRY_RUN) console.log(`  🚫 [excluido pickleball] ${p.title}`)
      continue
    }
    if (tituloLow.includes('beach tennis') || /\bbt\b/i.test(p.title)) {
      if (DRY_RUN) console.log(`  🚫 [excluido beach tennis] ${p.title}`)
      continue
    }
    if (tituloLow.includes('segunda mano') || tituloLow.includes('second hand') ||
        tituloLow.includes('2ª mano') || tituloLow.includes('2a mano') ||
        tituloLow.includes('reacondicionad') || tituloLow.includes('refurbished') ||
        tituloLow.includes('defectos esteticos') || tituloLow.includes('defectos estéticos')) {
      if (DRY_RUN) console.log(`  🚫 [segunda mano] ${p.title}`)
      continue
    }

    const textoNorm = normalizar(p.title)
    titulosProcessed.add(textoNorm)

    // ── Vía 1: alias (cache) ─────────────────────────────────────────────────
    const palaIdAlias = await buscarPorAlias(textoNorm)
    if (palaIdAlias) {
      if (DRY_RUN) {
        console.log(`  ✅ [alias] ${p.title}`)
      } else {
        const ok = await insertarSnapshot(palaIdAlias, sourceId, { precio: p.price, precioOriginal: p.precio_original, url: p.url, titulo: p.title })
        if (ok) {
          await actualizarImagenSiNull(palaIdAlias, p.image)
        } else {
          snapshotsFallidos++
        }
      }
      porAlias++
      continue
    }

    // ── Vía 2: extractor de atributos ────────────────────────────────────────
    const attrs = extraerAtributos(p.title)
    const candidatos = await buscarPorAtributos(attrs)

    if (candidatos.length === 1) {
      // Match único → snapshot + alias
      const palaId = candidatos[0].id
      if (DRY_RUN) {
        console.log(`  ✅ [atribs] ${p.title}`)
      } else {
        const ok = await insertarSnapshot(palaId, sourceId, { precio: p.price, precioOriginal: p.precio_original, url: p.url, titulo: p.title })
        if (ok) {
          await insertarAlias(palaId, p.title, TIENDA, p.url)
          await actualizarImagenSiNull(palaId, p.image)
        } else {
          snapshotsFallidos++
        }
      }
      porAtributos++
    } else if (candidatos.length > 1) {
      // Ambiguo → Gestor
      if (DRY_RUN) {
        console.log(`  ⚠️  [ambiguo] ${p.title} (${candidatos.length} candidatos)`)
        ambiguos++
      } else {
        if (await insertarCandidata({ titulo: p.title, precio: p.price, url: p.url, tienda: TIENDA, imagen: p.image }, 'ambiguo', attrs, candidatos)) ambiguos++
      }
    } else {
      // Sin match → Gestor
      if (DRY_RUN) {
        console.log(`  ❌ [sin match] ${p.title}`)
        sinMatch++
      } else {
        if (await insertarCandidata({ titulo: p.title, precio: p.price, url: p.url, tienda: TIENDA, imagen: p.image }, 'sin_match', attrs)) sinMatch++
      }
    }
  }

  // Limpiar candidatas obsoletas de esta tienda: titulos que ya no saca el scraper
  // (producto desaparecido o titulo cambiado por fix), o excluidos por EXCLUIR_MARCAS.
  if (!DRY_RUN) {
    const titulosEnScrape = new Set(productos.map(p => normalizar(p.title)))
    let off2 = 0; const candidatasObsoletas: string[] = []
    while (true) {
      const { data: cands } = await supabase.from('palas_candidatas')
        .select('id,titulo_normalizado,fuentes')
        .in('estado', ['pendiente', 'ambiguo'])
        .contains('fuentes', [TIENDA])
        .range(off2, off2 + 999)
      if (!cands || cands.length === 0) break
      for (const c of cands) {
        const soloEsta = (c.fuentes ?? []).length === 1
        const fueraDeEscrape = !titulosEnScrape.has(c.titulo_normalizado)
        const excluida = titulosEnScrape.has(c.titulo_normalizado) && !titulosProcessed.has(c.titulo_normalizado)
        if (soloEsta && (fueraDeEscrape || excluida)) candidatasObsoletas.push(c.id)
      }
      if (cands.length < 1000) break
      off2 += 1000
    }
    if (candidatasObsoletas.length > 0) {
      await supabase.from('palas_candidatas').update({ estado: 'ignorada' }).in('id', candidatasObsoletas)
      console.log('  🧹 ' + candidatasObsoletas.length + ' candidatas obsoletas/excluidas marcadas ignada')
    }
  }

  // Auto-limpieza: marcar como 'matched' las candidatas que ya tienen alias en BD
  if (!DRY_RUN) {
    const { data: limpiadas } = await supabase.rpc('cleanup_candidatas_matched')
    if (limpiadas) console.log(`  🧹 Limpiadas ${limpiadas} candidatas ya resueltas`)
  }

  // Post-pipeline automatico
  if (!DRY_RUN && !NO_POST) {
    console.log('\n── Post-pipeline ──────────────────────────────────────')
    await postPipeline()
  }

  console.log(`
📊 Resultado:
  ✅ Por alias:     ${porAlias}
  ✅ Por atributos: ${porAtributos}
  ⚠️  Ambiguos:     ${ambiguos}  → Gestor
  ❌ Sin match:     ${sinMatch}  → Gestor
  ${snapshotsFallidos > 0 ? `🔥 Snapshots fallidos: ${snapshotsFallidos}  (sin alias, revisar logs)\n  ` : ''}📦 Total:        ${productos.length}
  `)
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
 