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
// Fix 2026-06-22: este archivo tenía su PROPIA copia duplicada de toda la lógica
// de matching (normalizarLinea, modeloCompatible, buscarPorAtributos...) en vez
// de importarla de scripts/lib/modelo-matching.ts, a pesar de que el docstring
// de ese módulo afirma que "ambos importan de aquí — una sola fuente de verdad".
// Las dos copias ya habían divergido en producción: la rama de modeloCompatible()
// para catálogo-sin-modelo (tCat.length===0) aquí solo exigía que ALGÚN lado
// tuviera año conocido, sin comprobar que el número coincidiera con ese año —
// exactamente el bug que el comentario de modelo-matching.ts dice haber
// arreglado el 2026-06-21. pipeline-tiendas.ts nunca recibió ese fix porque no
// importaba de ahí. Ahora sí importa, así que un fix futuro en modelo-matching.ts
// beneficia automáticamente a los dos pipelines (tiendas + auto-promote) sin
// tener que recordar tocar este archivo también.
import {
  buscarPorAtributos as buscarPorAtributosCompartido,
  type AtributosExtraidos,
  type PalaCandidata,
} from './lib/modelo-matching'

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

// Catálogo completo y mapa de aliases, precargados UNA VEZ por ejecución en
// main() (ver cargarCatalogoCompleto/cargarAliasMap más abajo). Antes,
// buscarPorAtributos() y buscarPorAlias() hacían 1 consulta a Supabase POR
// PRODUCTO — con tiendas de 800+ productos eso eran miles de round-trips
// secuenciales, causa raíz confirmada del timeout-minutes:30 superado en
// GitHub Actions (2026-06-23: ~3.124 productos del grupo "Scrape A" × ~3.5
// round-trips × ~200ms ≈ 36 min, casi exactamente el tiempo del fallo real).
let catalogoCompleto: PalaCandidata[] = []
let aliasMap: Map<string, string> = new Map()

// Wrapper fino: la lógica de matching real vive en modelo-matching.ts (compartida
// con auto-promote-candidatas.ts). Solo adaptamos la firma porque ese módulo
// recibe el cliente supabase como parámetro explícito en vez de usar uno de
// módulo. La función solo se EJECUTA dentro de main(), momento en el que
// `supabase` y `catalogoCompleto` (declarados arriba) ya están inicializados,
// así que no hay problema de referenciar consts/lets definidos más abajo.
async function buscarPorAtributos(attrs: AtributosExtraidos) {
  return buscarPorAtributosCompartido(supabase, attrs, catalogoCompleto)
}

// Sustituye la consulta a `producto_aliases` por producto por una búsqueda en
// el mapa precargado en memoria (cargarAliasMap, llamado una vez en main()).
// Clave compuesta tienda+texto (ver nota de causa raíz junto a claveAlias()).
function buscarPorAlias(tienda: string, textoNorm: string): string | null {
  return aliasMap.get(claveAlias(tienda, textoNorm)) ?? null
}

async function cargarCatalogoCompleto(): Promise<PalaCandidata[]> {
  const out: PalaCandidata[] = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('palas')
      .select('id, nombre, marca, linea, modelo, variante, año')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`cargarCatalogoCompleto: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...(data as unknown as PalaCandidata[]))
    if (data.length < PAGE) break
    from += PAGE
  }
  return out
}

// Fix root-cause 2026-06-28: la clave única real de producto_aliases es
// `tienda + texto_normalizado` (así se guarda con onConflict:'tienda,texto_normalizado'
// y así lo edita GestorCandidatas al reasignar a mano). Pero este mapa se
// indexaba SOLO por texto_normalizado, ignorando la tienda — cuando el mismo
// título normalizado existe en varias tiendas (frecuente: la misma pala la
// vende medio mercado con un título casi idéntico), solo sobrevivía el
// primer alias que llegara al paginar, y ese podía ser el de OTRA tienda con
// un match erróneo. Consecuencia real reportada: Patricia reasignaba a mano
// el alias correcto de una tienda en GestorCandidatas → Verificación, y en
// el siguiente scrape esa tienda seguía cayendo en la pala equivocada,
// porque el alias "ganador" en memoria era el de otra tienda, no el suyo.
// Fix: indexar por tienda+texto_normalizado, igual que la clave real en BD.
function claveAlias(tienda: string, textoNorm: string): string {
  return `${tienda}::${textoNorm}`
}

async function cargarAliasMapDesdeBD(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('producto_aliases')
      .select('pala_id, texto_normalizado, tienda')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`cargarAliasMapDesdeBD: ${error.message}`)
    if (!data || data.length === 0) break
    for (const row of data as { pala_id: string; texto_normalizado: string; tienda: string }[]) {
      map.set(claveAlias(row.tienda, row.texto_normalizado), row.pala_id)
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  return map
}

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

// Marcas que no están (ni se van a dar de alta) en el catálogo `palas` y que generan
// ruido constante en "Pendientes que requieren revisión manual" (estado sin_match,
// marca_detectada=null). En vez de crear una candidata para que el Gestor las descarte
// a mano cada vez, se descartan aquí directamente antes de insertarCandidata().
// Revisar y quitar de esta lista si en el futuro se decide dar soporte a alguna.
// Nota: "wing[ -]?padel" porque las tiendas escriben tanto "WINGPADEL" (una palabra)
// como "WING PADEL" / "WING-PADEL" (separado) según el producto.
const MARCAS_EXCLUIDAS = [
  'ares', 'eclypse', 'leyenda', 'orygen', 'wing[ -]?padel', 'pala set', 'kugan', 'dreampadel',
]

function tituloTieneMarcaExcluida(titulo: string): boolean {
  const norm = titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return MARCAS_EXCLUIDAS.some(m => new RegExp(`\\b${m}\\b`, 'i').test(norm))
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
// Un producto matcheado (por alias o por atributos), pendiente de guardar en
// BD. En vez de escribir snapshot+alias+imagen por producto (1-3 round-trips
// secuenciales cada uno), el bucle principal de main() solo acumula aquí y
// flushMatches() lo escribe todo en bloques al final — ver nota de causa raíz
// más arriba (catalogoCompleto/aliasMap).
interface MatchPendiente {
  palaId: string
  precio: number
  precioOriginal?: number
  url: string
  titulo: string
  image?: string | null
  // Piloto coste-beneficio 2026-06-23: referencia/SKU que algunas tiendas (las
  // que usan WooCommerce Store API o Shopify products.json) ya traen gratis
  // en el mismo JSON. Se guarda en price_snapshots.sku SOLO para poder
  // comparar más adelante si el valor es consistente entre tiendas para el
  // mismo producto — de momento NO se usa en ningún punto del matching, así
  // que no afecta a la lógica de buscarPorAtributos/buscarPorAlias existente.
  sku?: string | null
  crearAlias: boolean // true solo si vino por atributos (por alias ya existe)
  // Fix root-cause 2026-06-24 (Futura Padel Shop "agotada" mostrada como
  // disponible): antes se hardcodeaba disponible=true en flushMatches sin
  // leer el stock real de la tienda. Ahora se propaga aquí desde el scraper
  // (p.disponible, cuando lo trae) y, si no viene, se asume true como antes.
  disponible?: boolean
  // Codigo de descuento detectado por _discount-utils.js a nivel de pagina
  // (banner de tienda, no por producto individual) — ver nota junto a
  // codigoDescuentoTienda en el bucle principal.
  codigoDescuento?: string | null
  descuentoPct?: number | null
}

// Vuelca los matches pendientes en bloques de CHUNK. Devuelve cuántos
// snapshots fallaron (para que el llamador no cree alias de ese bloque ni
// los cuente como éxito en el resumen final).
async function flushMatches(pendientes: MatchPendiente[], sourceId: string): Promise<number> {
  const CHUNK = 300
  const CONCURRENCIA_IMG = 15
  let fallidos = 0

  for (let i = 0; i < pendientes.length; i += CHUNK) {
    const chunkBruto = pendientes.slice(i, i + CHUNK)

    // Fix real 2026-06-23 (latiendadelpadel, "ON CONFLICT DO UPDATE command
    // cannot affect row a second time"): un upsert multi-fila con
    // onConflict:'pala_id,source_id' revienta si DOS productos del mismo
    // bloque resuelven al mismo pala_id (la misma tienda no puede tener 2
    // precios simultáneos para la misma pala). Antes esto abortaba el
    // bloque ENTERO (hasta 300 productos sin snapshot ni alias) tras 2
    // intentos idénticos — el reintento nunca podía arreglar un conflicto
    // que viene de los propios datos del lote, no de la red. Causa raíz real
    // es de matching (dos títulos distintos colapsando al mismo pala_id),
    // pero aquí — al volcar a BD — es donde hay que blindarse: se queda solo
    // con la primera ocurrencia de cada pala_id y se loggean las demás como
    // colisión para poder investigar el matching después, en vez de perder
    // el bloque completo por un solo par conflictivo.
    const vistos = new Map<string, MatchPendiente>()
    const colisiones: MatchPendiente[] = []
    for (const m of chunkBruto) {
      const previo = vistos.get(m.palaId)
      if (previo) {
        colisiones.push(m)
      } else {
        vistos.set(m.palaId, m)
      }
    }
    if (colisiones.length > 0) {
      for (const c of colisiones) {
        const original = vistos.get(c.palaId)
        console.error(`  ⚠️  [colisión pala_id] "${c.titulo}" y "${original?.titulo}" resolvieron a la misma pala (${c.palaId}) en el mismo scrape — se descarta "${c.titulo}", revisar matching`)
      }
    }
    const chunk = Array.from(vistos.values())
    const payloadSnaps = chunk.map(m => ({
      pala_id:          m.palaId,
      source_id:        sourceId,
      precio:           m.precio,
      precio_original:  m.precioOriginal ?? null,
      url_producto:     m.url,
      match_confidence:  1.0,
      // Fix root-cause 2026-06-24: antes siempre true, ignorando el stock
      // real. Si el scraper trae disponible (p.ej. Shopify variant.available),
      // se respeta; si no lo trae, se asume true (comportamiento previo).
      disponible:       m.disponible ?? true,
      scraped_at:       new Date().toISOString(),
      sku:              m.sku ?? null,
      codigo_descuento: m.codigoDescuento ?? null,
      descuento_pct:    m.descuentoPct ?? null,
    }))

    let ok = false
    for (let intento = 1; intento <= 2; intento++) {
      const { error } = await supabase.from('price_snapshots')
        .upsert(payloadSnaps, { onConflict: 'pala_id,source_id' })
      if (!error) { ok = true; break }
      if (intento === 1) {
        console.error(`  ⚠️  [snapshot batch ${i}-${i + chunk.length}] ${error.message} — reintentando…`)
        await new Promise(r => setTimeout(r, 1000))
      } else {
        console.error(`  ❌ [snapshot batch ${i}-${i + chunk.length}] ${error.message} (tras reintento, NO se crean aliases de este bloque)`)
      }
    }
    if (!ok) { fallidos += chunkBruto.length; continue }

    // Histórico insert-only (2026-06-24): price_snapshots se sobrescribe
    // (upsert por pala_id,source_id) y solo guarda el último precio visto.
    // price_history_log acumula CADA scrape como fila nueva, para poder
    // analizar más adelante a qué horas/días baja de precio cada tienda.
    // Fallo aquí NO debe tirar el pipeline ni descartar el snapshot ya
    // guardado: solo se loggea.
    const { error: errHist } = await supabase.from('price_history_log').insert(payloadSnaps)
    if (errHist) console.error(`  ⚠️  [history batch ${i}-${i + chunk.length}] ${errHist.message}`)

    const aliasesNuevos = chunk.filter(m => m.crearAlias).map(m => ({
      pala_id:           m.palaId,
      texto_original:    m.titulo,
      texto_normalizado: normalizar(m.titulo),
      tienda:            TIENDA,
      fuente_url:        m.url,
      confianza:         1.0,
    }))
    if (aliasesNuevos.length > 0) {
      const { error: errAlias } = await supabase.from('producto_aliases')
        .upsert(aliasesNuevos, { onConflict: 'tienda,texto_normalizado', ignoreDuplicates: true })
      if (errAlias) console.error(`  ⚠️  [alias batch ${i}-${i + chunk.length}] ${errAlias.message}`)
    }

    // Imagen: solo si imagen_url es NULL en BD — no se puede batchear en un
    // único upsert (cada fila lleva una URL distinta y no queremos arriesgar
    // pisar otras columnas), así que se paraleliza con concurrencia limitada
    // en vez de secuencial uno a uno.
    const conImagen = chunk.filter(m => m.image)
    for (let j = 0; j < conImagen.length; j += CONCURRENCIA_IMG) {
      await Promise.all(conImagen.slice(j, j + CONCURRENCIA_IMG).map(m =>
        supabase.from('palas').update({ imagen_url: m.image }).eq('id', m.palaId).is('imagen_url', null)
      ))
    }
  }

  return fallidos
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

async function scrape(tienda: string): Promise<{ title: string; price: number; precio_original?: number; url: string; image?: string | null; sku?: string | null; disponible?: boolean; codigoDescuento?: string | null; descuentoPct?: number | null }[]> {
  const scraper = require(`./prices/scrapers/${tienda}.js`)
  const productos = scraper.scrape ? await scraper.scrape() : await scraper()
  // Piloto 2026-06-28: algunos scrapers HTML (ver _discount-utils.js) marcan
  // el array devuelto con una propiedad `codigoDescuento` cuando detectan un
  // banner de cupon a nivel de pagina (no por producto). `.map()` crea un
  // array NUEVO que no hereda esa propiedad, así que hay que rescatarla del
  // array original ANTES de mapear y volver a colgarla del resultado.
  const codigoDescuento = (productos as any).codigoDescuento ?? null
  const mapeados = productos.map((p: any) => ({ ...p, title: decodeHtmlEntities(p.title) }))
  ;(mapeados as any).codigoDescuento = codigoDescuento
  return mapeados
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

  // 1c. Precargar catálogo completo + mapa de aliases UNA VEZ (ver nota de
  // causa raíz junto a la declaración de catalogoCompleto/aliasMap arriba).
  // Se hace también en --dry-run porque el matching (no la escritura) sigue
  // necesitando catálogo y aliases para decidir alias/atribs/ambiguo/sin-match.
  console.log('\n📚 Precargando catálogo y aliases…')
  catalogoCompleto = await cargarCatalogoCompleto()
  aliasMap = await cargarAliasMapDesdeBD()
  console.log(`  → ${catalogoCompleto.length} palas, ${aliasMap.size} aliases en memoria`)

  // 2. Scrape
  console.log(`\n📥 Scrapeando ${TIENDA}...`)
  const productos = await scrape(TIENDA)
  console.log(`  → ${productos.length} productos`)

  // 3. Matching
  let porAlias = 0, porAtributos = 0, ambiguos = 0, sinMatch = 0, snapshotsFallidos = 0
  const titulosProcessed = new Set<string>()
  // Acumulador de matches para escribirlos todos en bloques al final del
  // bucle (flushMatches) en vez de un round-trip a Supabase por producto.
  const pendientesMatch: MatchPendiente[] = []

  // Prefijos que indican que NO es una pala individual
  const EXCLUIR_PREFIJOS = ['pack ', 'super pack ', 'pala test ', 'bolso ', 'accesorio ', 'pala de padel open']

  // Fix 20260629: ropa, calzado y paleteros coladas en pendientes desde tiendas
  // sin filtro propio de categoría (padelcoronado, zonadepadel, padelnuestro,
  // tiendapadel5 — confirmado vía SQL real: 70 filas en pendientes hoy, todas
  // de estas 4 tiendas). Estos 4 scrapers no tienen su propio isPala()/EXCLUIR
  // (a diferencia de futurapadelshop.js, que sí filtra en origen), así que caían
  // siempre en "sin match" → Gestor. Filtro central por palabra completa (\b)
  // para no generar falsos positivos con nombres de modelo de pala.
  const ROPA_CALZADO_ACCESORIOS =
    /\b(camisetas?|sudaderas?|polos?|shorts?|pantal[oó]n(es)?|faldas?|mallas?|chalecos?|cortavientos|calcet[ií]n(es)?|zapatillas?|paleteros?)\b/i
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

  // Piloto 2026-06-28: codigo de descuento detectado a nivel de pagina (no
  // por producto) — se aplica igual a todos los productos de este scrape de
  // esta tienda. Validado en vivo solo contra padelmania.com de momento (ver
  // _discount-utils.js); el resto de scrapers no llaman al detector aun, así
  // que aquí valdrá null para ellos y no cambia nada de su comportamiento.
  let codigoDescuentoTienda = (productos as any).codigoDescuento as { codigo: string; descuento_pct: number } | null

  // Fallback manual (tarea #177): si el scraper no detectó un código automático
  // para esta tienda, se usa el que Patricia haya introducido a mano desde
  // GestorCandidatas (pestaña "💸 Códigos" → tabla codigos_descuento_manual).
  // Útil para las tiendas donde el detector genérico no aplica (Shopify/WooCommerce
  // JSON-only) o no encuentra nada. Se aplica igual a todos los productos del
  // run, igual que el código automático.
  if (!codigoDescuentoTienda && !DRY_RUN) {
    const { data: manual } = await supabase
      .from('codigos_descuento_manual')
      .select('codigo, descuento_pct')
      .eq('source_id', sourceId)
      .eq('activo', true)
      .maybeSingle()
    if (manual) {
      codigoDescuentoTienda = { codigo: manual.codigo, descuento_pct: manual.descuento_pct }
      console.log(`  💸 Código manual aplicado: ${manual.codigo} (-${manual.descuento_pct}%)`)
    }
  }

  for (const p of productos) {
    const tituloLow = p.title.toLowerCase()
    if (EXCLUIR_PREFIJOS.some(pref => tituloLow.startsWith(pref))) {
      if (DRY_RUN) console.log(`  🚫 [excluido] ${p.title}`)
      continue
    }
    // Bug detectado 20260621: varias entradas de EXCLUIR_MARCAS ('rox ', 'hybrid padel',
    // 'hbl ', etc.) nunca matcheaban porque los títulos casi siempre empiezan con
    // "Pala " (ej. "Pala Rox R-Sparky Xtreme 3D"), y startsWith(m) exige que la marca
    // esté en la posición 0. Se comprueba también con el prefijo "pala " quitado.
    const tituloSinPala = tituloLow.startsWith('pala ') ? tituloLow.slice(5) : tituloLow
    if (EXCLUIR_MARCAS.some(m => tituloLow.startsWith(m) || tituloSinPala.startsWith(m))) {
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
    if (ROPA_CALZADO_ACCESORIOS.test(p.title)) {
      if (DRY_RUN) console.log(`  🚫 [ropa/calzado/accesorio] ${p.title}`)
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
    const palaIdAlias = buscarPorAlias(TIENDA, textoNorm)
    if (palaIdAlias) {
      if (DRY_RUN) {
        console.log(`  ✅ [alias] ${p.title}`)
      } else {
        pendientesMatch.push({
          palaId: palaIdAlias, precio: p.price, precioOriginal: p.precio_original,
          url: p.url, titulo: p.title, image: p.image, sku: p.sku ?? null, crearAlias: false,
          disponible: p.disponible,
          codigoDescuento: codigoDescuentoTienda?.codigo ?? null,
          descuentoPct: codigoDescuentoTienda?.descuento_pct ?? null,
        })
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
        pendientesMatch.push({
          palaId, precio: p.price, precioOriginal: p.precio_original,
          url: p.url, titulo: p.title, image: p.image, sku: p.sku ?? null, crearAlias: true,
          disponible: p.disponible,
          codigoDescuento: codigoDescuentoTienda?.codigo ?? null,
          descuentoPct: codigoDescuentoTienda?.descuento_pct ?? null,
        })
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

  // Volcar a BD todos los matches acumulados durante el bucle, en bloques
  // (ver flushMatches) — esto sustituye los 1-3 round-trips por producto que
  // eran la causa raíz del timeout.
  if (!DRY_RUN && pendientesMatch.length > 0) {
    console.log(`\n💾 Guardando ${pendientesMatch.length} matches en BD (en bloques)...`)
    snapshotsFallidos = await flushMatches(pendientesMatch, sourceId)
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
