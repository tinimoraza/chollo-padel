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
const MIN_FUENTES = 2
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

// Precio real que pagaria el usuario si existe un codigo_descuento detectado
// (o introducido a mano) en este snapshot. Se usa tanto para decidir que
// snapshot es "el mas barato" por pala (dedup) como para el ratio CHOLLO/
// OFERTA - asi una tienda con codigo activo puede ganar a otra mas cara sin
// codigo, que es justo el caso real que motivo la tarea #175.
function precioEfectivo(snap: { precio: number; codigo_descuento?: string | null; descuento_pct?: number | null }): number {
  if (snap.codigo_descuento && snap.descuento_pct && snap.descuento_pct > 0) {
    return snap.precio * (1 - snap.descuento_pct / 100)
  }
  return snap.precio
}

export async function GET() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

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
  for (let from = 0; from <= 5000; from += PAGE_SIZE) {
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

  const byTienda = new Map<string, typeof snapshots[0]>()
  for (const snap of snapshots) {
    const key = `${snap.pala_id}__${snap.source_id}`
    const existing = byTienda.get(key)
    if (!existing || snap.scraped_at > existing.scraped_at) byTienda.set(key, snap)
  }
  const byKey = new Map<string, typeof snapshots[0]>()
  for (const snap of Array.from(byTienda.values())) {
    const existing = byKey.get(snap.pala_id)
    if (!existing || precioEfectivo(snap) < precioEfectivo(existing)) byKey.set(snap.pala_id, snap)
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
    // fuentes, match_confidence=1 en todas, min=74.95 max=269.95 -> spread
    // 3.6x). El guard se diseno para detectar matches CONTAMINADOS (precios
    // dispares por error de matching), no para penalizar variacion real de
    // precio entre muchas tiendas independientes - y cuantas mas fuentes
    // coinciden de forma consistente, menos probable es que sea un error de
    // matching. Fix: tolerancia de spread escalada por fuentes_count en vez
    // de un umbral unico - mas fuentes = mas confianza = mas margen.
    // Con exactamente 2 fuentes y spread > 1.8x, el precio referencia es poco
    // fiable (un precio de lista muy alto + uno muy bajo da una mediana inutil).
    // Casos reales: pala descatalogada en una tienda a precio outlet + precio
    // de lista en otra. Se descarta hasta que haya >= 3 fuentes reales.
    const spreadMaximo = priceRef.fuentes_count >= 5 ? 4.0 : (priceRef.fuentes_count === 2 ? 1.8 : MAX_SPREAD)
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

    // Tarea #175: si el snapshot tiene un codigo de descuento extra (detectado
    // por el scraper o introducido a mano via la tool), el precio real que
    // paga el usuario es precioFinal - y es ESE el que decide ratio/tag/orden,
    // no el precio bruto scrapeado.
    const tieneCodigo = !!(snap.codigo_descuento && snap.descuento_pct && snap.descuento_pct > 0)
    const precioFinal = precioEfectivo(snap)

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
      codigo_descuento:     tieneCodigo ? snap.codigo_descuento : null,
      precio_sin_codigo:    tieneCodigo ? snap.precio : null,
      descuento_codigo_pct: tieneCodigo ? snap.descuento_pct : null,
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

  return NextResponse.json(
    {
      chollos,
      total: chollos.length,      chollos_count: chollos.filter(c => c.tag === 'CHOLLO').length,
      ofertas_count: chollos.filter(c => c.tag === 'OFERTA').length,
      updated_at: updatedAt,
      _dbg,
      _dbgMeta: { snapshots_raw: snapshots.length, after_dedup: byKey.size },
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  )
}

  )
}
