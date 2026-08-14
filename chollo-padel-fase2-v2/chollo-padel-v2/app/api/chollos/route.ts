/**
 * app/api/chollos/route.ts
 * GET /api/chollos
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export interface CholloTienda {
  pala_id:           string
  modelo:            string
  nombre:            string
  marca:             string
  ano:               number
  slug:              string
  imagen_url:        string | null
  precio_actual:     number
  precio_original:   number | null
  precio_referencia: number
  descuento_pct:     number
  url_producto:      string
  tienda:            string
  tienda_slug:       string
  scraped_at:        string
  tag:               'CHOLLO' | 'OFERTA'
  // Codigo de descuento extra detectado por el scraper (banner de tienda) o
  // introducido a mano via la tool de gestion. Si esta presente, precio_actual
  // YA lleva aplicado el descuento_codigo_pct (ver bucle principal mas abajo).
  codigo_descuento:     string | null
  precio_sin_codigo:    number | null
  descuento_codigo_pct: number | null
  // Cuándo apareció este chollo por primera vez (de chollos_notificados)
  primera_vez_at:       string | null
}

const UMBRAL_CHOLLO = 0.65
const UMBRAL_OFERTA = 0.75
const MIN_REFERENCIA = 50
const MIN_FUENTES = 3
const MAX_SPREAD  = 2.5
const MIN_ANO = 2024

const URL_MODEL_COLISIONES: [string, string][] = [
  ['counter-origin',    'counter veron'],
  ['counter-viper',     'counter veron'],
  ['extreme-motion',    'extreme tour'],
  ['counter-viper-apt', 'counter viper'],
  ['arrow-hit-hexagon', 'arrow hit'],
  ['match-light-3-2',   'match light 2026'],
  ['cross-it-light',    'cross it light 2026'],
  ['x-one-c6',          'x-one 2025'],
  ['lapi-edition',      'tournament pro iconic'],
]

function esDescartadoPorGuardias(
  urlProducto: string,
  palaAno: number,
  palaModelo: string,
  palaIdsConMismaUrl: Set<string>
): string | null {
  const url = urlProducto.toLowerCase()

  const m4 = url.match(/20(\d{2})/)
  if (m4) {
    const urlYear = parseInt(m4[0], 10)
    if (urlYear !== palaAno) return `A: anyo URL ${urlYear} != catalogo ${palaAno}`
  }

  if (!m4) {
    const slug = url.split('/').filter(Boolean).pop() ?? url
    const m2 = slug.match(/-(1[9]|2[0-9])-(?!\d{3,})/)
    if (m2) {
      const shortYear = parseInt(m2[1], 10)
      const fullYear = 2000 + shortYear
      if (fullYear !== palaAno) return `B: sufijo -${m2[1]}- en URL implica ${fullYear} != catalogo ${palaAno}`
    }
  }

  if (palaIdsConMismaUrl.size > 1) return `C: URL compartida con ${palaIdsConMismaUrl.size - 1} pala(s) mas`

  const modeloLower = (palaModelo ?? '').toLowerCase()
  for (const [urlFrag, modelFrag] of URL_MODEL_COLISIONES) {
    if (url.includes(urlFrag) && modeloLower.includes(modelFrag)) {
      return `D: URL contiene "${urlFrag}" pero modelo es "${modelFrag}"`
    }
  }

  if (url.includes('padelproshop.com')) {
    const mCode = url.match(/-(2\d{2})(?:[^\d]|$)/)
    if (mCode) {
      const codeYear = 2000 + parseInt(mCode[1].slice(1), 10)
      if (codeYear >= 2018 && codeYear <= 2030 && codeYear !== palaAno) {
        return `E: codigo padelproshop -${mCode[1]} = ${codeYear} != catalogo ${palaAno}`
      }
    }
  }

  return null
}

interface CodigoActivo {
  codigo: string
  descuento_pct: number
  marca_restringida: string | null
}

// Codigo activo (si lo hay, y si aplica a la marca de esta pala) para un
// snapshot. Fix 2026-08-14: antes se leia snap.codigo_descuento/descuento_pct,
// que quedaban "congelados" en el momento del scrape de esa tienda. Ahora se
// consulta codigos_descuento_manual EN VIVO en el momento de calcular
// /api/chollos, porque el escaneo de codigos (chollo-padel-codigos-extension,
// extension Chrome independiente) corre desacoplado del scrape de catalogo
// y con mas frecuencia — asi un
// codigo que caduca a mediodia deja de aplicarse aunque el precio no se haya
// vuelto a scrapear, y uno nuevo se aplica sin esperar al proximo scrape.
function codigoAplicable(snap: any, codigosMap: Map<number, CodigoActivo>): CodigoActivo | null {
  const cod = codigosMap.get(snap.source_id)
  if (cod && cod.descuento_pct > 0) {
    if (cod.marca_restringida) {
      const marcaPala = ((snap.palas as any)?.marca ?? '').toLowerCase()
      if (marcaPala !== cod.marca_restringida.toLowerCase()) return null
    }
    return cod
  }

  // Fix 2026-08-14 (segunda vuelta): el paso a "codigo en vivo" (arriba) solo
  // cubre codigos DE TIENDA que mantiene codigos_descuento_manual (la
  // extension de codigos). Pero ~20 scrapers (misterpadel, tennispoint,
  // padeliberico, padelkiwi, pelotapadel, time2padel, padelproshop...)
  // detectan un codigo POR PRODUCTO directamente en la ficha en cada scrape y
  // lo graban en price_snapshots.codigo_descuento/descuento_pct — ese valor
  // se queda fresco solo mientras el producto se siga scrapeando (no es un
  // valor viejo y olvidado, se re-detecta cada pasada del scraper). Al
  // limitar la funcion solo a codigosMap se dejo de aplicar ese descuento por
  // producto y varios chollos reales (ej. Nox Ea10 en misterpadel) dejaron de
  // salir. Fallback: si no hay codigo de tienda en vivo, usar el que trajo el
  // propio snapshot.
  if (snap.codigo_descuento && snap.descuento_pct && Number(snap.descuento_pct) > 0) {
    return { codigo: snap.codigo_descuento, descuento_pct: Number(snap.descuento_pct), marca_restringida: null }
  }

  return null
}

// Precio real que pagaria el usuario si hay un codigo de descuento aplicable
// a este snapshot ahora mismo. Se usa tanto para decidir que snapshot es "el
// mas barato" por pala (dedup) como para el ratio CHOLLO/OFERTA - asi una
// tienda con codigo activo puede ganar a otra mas cara sin codigo, que es
// justo el caso real que motivo la tarea #175.
function precioEfectivo(snap: { precio: number }, cod: CodigoActivo | null): number {
  if (cod) return snap.precio * (1 - cod.descuento_pct / 100)
  return snap.precio
}

export async function GET() {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  // Códigos de descuento activos AHORA MISMO (ver codigoAplicable arriba) —
  // se cargan una vez por request, en vivo, en vez de fiarse de lo que quedó
  // congelado en cada price_snapshot en el momento del scrape.
  const { data: codigosRows } = await supabaseAdmin
    .from('codigos_descuento_manual')
    .select('source_id, codigo, descuento_pct, marca_restringida')
    .eq('activo', true)
  const codigosMap = new Map<number, CodigoActivo>()
  for (const c of (codigosRows ?? [])) {
    codigosMap.set(c.source_id, { codigo: c.codigo, descuento_pct: c.descuento_pct, marca_restringida: c.marca_restringida ?? null })
  }

  // Cargar mapa de primera_vez_at desde chollos_notificados
  const { data: notificados } = await supabaseAdmin
    .from('chollos_notificados')
    .select('pala_id, source_id, primera_vez_at')
    .eq('activo', true)
  const notificadosMap = new Map<string, string>()
  for (const n of (notificados ?? [])) {
    notificadosMap.set(`${n.pala_id}__${n.source_id}`, n.primera_vez_at)
  }

  // price_reference se incluye inline en el join para evitar una segunda query
  // con IN de 1000+ UUIDs que excede el limite de URL de PostgREST.
  //
  // NOTA (fix 2026-06-19): Supabase (PostgREST) tiene un tope "Max Rows" por
  // request (por defecto 1000) que IGNORA el .range(0, 5000) que pediamos -
  // cualquier .range() que pida mas de ese tope se trunca silenciosamente a
  // 1000 filas, SIN error. Con 19+ tiendas activas ya hay >5000 snapshots en
  // 24h (confirmado: 5053), asi que una sola query SIEMPRE se quedaba corta.
  // Al venir ordenado por scraped_at DESC, se truncaban las filas mas
  // ANTIGUAS dentro de la ventana de 24h - es decir, justo las tiendas cuyo
  // job de GitHub Actions termina antes en el batch (caso real: latiendadelpadel,
  // que escanea en el job "scrape-grupo-b" y termina ~10-15 min antes que
  // padelcoronado/ofertasdepadel en grupo-a). Sus snapshots quedaban fuera de
  // la query y nunca llegaban a evaluarse en los guards/ratio -> ningun chollo
  // de esas tiendas podia aparecer aunque el precio fuera el mas barato.
  // Fix: paginar en bloques de 1000 hasta agotar los resultados.
  // 2026-07-30: límite subido de 6000→21000 (8150 snaps reales en 48h;
  // scrapers de extensión corren antes del pipeline principal y quedaban fuera).
  const PAGE_SIZE = 1000
  function fetchPage(from: number, to: number) {
    return supabaseAdmin
      .from('price_snapshots')
      .select(`
        pala_id,
        precio,
        precio_original,
        url_producto,
        scraped_at,
        source_id,
        codigo_descuento,
        descuento_pct,
        price_sources ( nombre, slug ),
        palas ( *, price_reference ( precio_referencia, fuentes_count, precio_minimo, precio_maximo ) )
      `)
      .eq('disponible', true)
      .gte('scraped_at', since)
      .gte('match_confidence', 0.95)
      .neq('source_id', 2)
      .order('scraped_at', { ascending: false })
      .range(from, to)
  }

  const snapshots: any[] = []
  for (let from = 0; from <= 20000; from += PAGE_SIZE) {
    const { data: page, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) {
      return NextResponse.json({ error: 'Error cargando chollos', detail: error.message }, { status: 500 })
    }
    if (!page || page.length === 0) break
    snapshots.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  if (!snapshots || snapshots.length === 0) {
    return NextResponse.json({ chollos: [], updated_at: null }, { headers: { 'Cache-Control': 'no-store' } })
  }

  // Filtrar ref-stale ANTES de deduplicar: si el snapshot más reciente de una
  // tienda es más nuevo que precios_updated_at+3h (el post-pipeline aún no corrió),
  // lo descartamos aquí para que el dedup pueda caer al snapshot anterior válido.
  // De lo contrario, el dedup elige el más reciente, el guard posterior lo descarta,
  // y no hay fallback → 0 chollos durante el pipeline.
  const GRACIA_MS = 3 * 60 * 60 * 1000
  const snapsFiltradosEstrictos = snapshots.filter(snap => {
    const pala = snap.palas as any
    if (!pala) return false
    const refUpdatedAt = pala.precios_updated_at ? new Date(pala.precios_updated_at).getTime() : 0
    const snapAt = new Date(snap.scraped_at).getTime()
    return snapAt <= refUpdatedAt + GRACIA_MS
  })

  // Fallback: si el filtro estricto vacía todo (pipeline en curso o precios_updated_at
  // desactualizado), usar todos los snapshots. Los guards de ratio/minimo/spread
  // siguen activos y evitan chollos falsos. Así la página nunca se queda vacía.
  const snapsFiltrados = snapsFiltradosEstrictos.length > 0 ? snapsFiltradosEstrictos : snapshots

  const byTienda = new Map<string, typeof snapshots[0]>()
  for (const snap of snapsFiltrados) {
    const key = `${snap.pala_id}__${snap.source_id}`
    const existing = byTienda.get(key)
    if (!existing || snap.scraped_at > existing.scraped_at) byTienda.set(key, snap)
  }
  const byKey = new Map<string, typeof snapshots[0]>()
  for (const snap of Array.from(byTienda.values())) {
    const existing = byKey.get(snap.pala_id)
    if (!existing || precioEfectivo(snap, codigoAplicable(snap, codigosMap)) < precioEfectivo(existing, codigoAplicable(existing, codigosMap))) {
      byKey.set(snap.pala_id, snap)
    }
  }

  const urlToPalaIds = new Map<string, Set<string>>()
  for (const snap of Array.from(byKey.values())) {
    if (!urlToPalaIds.has(snap.url_producto)) urlToPalaIds.set(snap.url_producto, new Set())
    urlToPalaIds.get(snap.url_producto)!.add(snap.pala_id)
  }

  const chollos: CholloTienda[] = []
  const _dbg: string[] = []

  for (const snap of Array.from(byKey.values())) {
    const pala = snap.palas as any
    const fuente = snap.price_sources as any

    if (!pala || !fuente) { _dbg.push(`no-pala/fuente|${snap.pala_id}`); continue }

    const palaAno = pala['año'] ?? pala['ano'] ?? null
    if (palaAno === null || palaAno < MIN_ANO) { _dbg.push(`ano=${palaAno}|${pala.modelo}`); continue }

    const priceRefArr = pala.price_reference
    const priceRefRaw = Array.isArray(priceRefArr) ? priceRefArr[0] : priceRefArr
    if (!priceRefRaw) { _dbg.push(`no-priceRef|${pala.modelo}|ano=${palaAno}`); continue }

    const priceRef = {
      precio_referencia: Number(priceRefRaw.precio_referencia),
      fuentes_count:     priceRefRaw.fuentes_count as number,
      precio_minimo:     Number(priceRefRaw.precio_minimo),
      precio_maximo:     Number(priceRefRaw.precio_maximo),
    }

    if (priceRef.fuentes_count < MIN_FUENTES) { _dbg.push(`fuentes=${priceRef.fuentes_count}|${pala.modelo}`); continue }

    // Bug real 2026-06-21: MAX_SPREAD=2.5 fijo descartaba chollos genuinos en
    // productos con muchas tiendas (ej. Bullpadel Vertex 04 25 Women: 8
    // fuentes, spread 3.6x). Fix: con >= 5 fuentes se amplia tolerancia a 4.0x.
    // Para 2-4 fuentes se mantiene MAX_SPREAD=2.5; la disponibilidad real la
    // garantiza el scraper, no este guard.
    const spreadMaximo = priceRef.fuentes_count >= 5 ? 4.0 : MAX_SPREAD
    if (priceRef.precio_minimo > 0 && priceRef.precio_maximo / priceRef.precio_minimo > spreadMaximo) { _dbg.push(`spread|${pala.modelo}`); continue }

    const ref = priceRef.precio_referencia
    if (!ref || ref < MIN_REFERENCIA) { _dbg.push(`ref<MIN|ref=${ref}|${pala.modelo}`); continue }

    const umbralMinimo = priceRef.fuentes_count >= 3 ? 0.75 : 0.65
    if (priceRef.precio_minimo > 0 && snap.precio / priceRef.precio_minimo < umbralMinimo) {
      _dbg.push(`minimo|${snap.precio}/${priceRef.precio_minimo}<${umbralMinimo}|${pala.modelo}`)
      continue
    }

    const palaIdsEnEstaUrl = urlToPalaIds.get(snap.url_producto) ?? new Set([snap.pala_id])
    const motivo = esDescartadoPorGuardias(snap.url_producto, palaAno, pala.modelo, palaIdsEnEstaUrl)
    if (motivo) { _dbg.push(`guardia:${motivo}|${pala.modelo}`); continue }

    // Tarea #175 (y fix 2026-08-14, código en vivo): si hay un codigo de
    // descuento activo AHORA MISMO para esta tienda (y aplicable a la marca
    // de esta pala), el precio real que paga el usuario es precioFinal - y
    // es ESE el que decide ratio/tag/orden, no el precio bruto scrapeado.
    const codigoActivo = codigoAplicable(snap, codigosMap)
    const tieneCodigo = !!codigoActivo
    const precioFinal = precioEfectivo(snap, codigoActivo)

    const ratio = precioFinal / ref
    if (ratio > UMBRAL_OFERTA) { _dbg.push(`ratio=${ratio.toFixed(3)}>${UMBRAL_OFERTA}|${pala.modelo}`); continue }

    const descuento_pct = Math.round((1 - ratio) * 100)
    const tag: 'CHOLLO' | 'OFERTA' = ratio <= UMBRAL_CHOLLO ? 'CHOLLO' : 'OFERTA'

    chollos.push({
      pala_id:           snap.pala_id,
      modelo:            pala.modelo,
      nombre:            pala.nombre ?? pala.modelo,
      marca:             pala.marca,
      ano:               palaAno,
      slug:              pala.slug,
      imagen_url:        pala.imagen_url,
      precio_actual:     precioFinal,
      precio_original:   snap.precio_original,
      precio_referencia: ref,
      descuento_pct,
      url_producto:      snap.url_producto,
      tienda:            fuente.nombre,
      tienda_slug:       fuente.slug,
      scraped_at:        snap.scraped_at,
      tag,
      codigo_descuento:     tieneCodigo ? codigoActivo!.codigo : null,
      precio_sin_codigo:    tieneCodigo ? snap.precio : null,
      descuento_codigo_pct: tieneCodigo ? codigoActivo!.descuento_pct : null,
      primera_vez_at:       notificadosMap.get(`${snap.pala_id}__${snap.source_id}`) ?? null,
    })
  }

  chollos.sort((a, b) => {
    if (a.tag !== b.tag) return a.tag === 'CHOLLO' ? -1 : 1
    return b.descuento_pct - a.descuento_pct
  })

  const updatedAt = chollos.length > 0
    ? chollos.reduce((max, c) => c.scraped_at > max ? c.scraped_at : max, chollos[0].scraped_at)
    : null

  // Detectar si el pipeline está en curso: hay snapshots recientes (<1h) pero
  // ninguno calificó como chollo. Esto puede ocurrir cuando el post-pipeline
  // aún no ha recalculado price_reference con los nuevos datos.
  const ahora = Date.now()
  const tieneSnapsRecientes = snapshots.some(
    s => ahora - new Date(s.scraped_at).getTime() < 60 * 60 * 1000
  )
  const actualizando = chollos.length === 0 && snapshots.length > 0 && tieneSnapsRecientes

  return NextResponse.json(
    {
      chollos,
      total: chollos.length,
      chollos_count: chollos.filter(c => c.tag === 'CHOLLO').length,
      ofertas_count: chollos.filter(c => c.tag === 'OFERTA').length,
      updated_at: updatedAt,
      actualizando,
      _dbg,
      _dbgMeta: { snapshots_raw: snapshots.length, after_dedup: byKey.size },
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  )
}
