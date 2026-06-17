/**
 * app/api/chollos/route.ts
 * GET /api/chollos
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

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
}

const UMBRAL_CHOLLO = 0.70
const UMBRAL_OFERTA = 0.82
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

export async function GET() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // price_reference se incluye inline en el join para evitar una segunda query
  // con IN de 1000+ UUIDs que excede el limite de URL de PostgREST.
  const { data: snapshots, error } = await supabaseAdmin
    .from('price_snapshots')
    .select(`
      pala_id,
      precio,
      precio_original,
      url_producto,
      scraped_at,
      source_id,
      price_sources ( nombre, slug ),
      palas ( *, price_reference ( precio_referencia, fuentes_count, precio_minimo, precio_maximo ) )
    `)
    .eq('disponible', true)
    .gte('scraped_at', since)
    .gte('match_confidence', 0.95)
    .neq('source_id', 2)
    .order('scraped_at', { ascending: false })
    .range(0, 5000)

  if (error) {
    return NextResponse.json({ error: 'Error cargando chollos', detail: error.message }, { status: 500 })
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
    if (!existing || snap.precio < existing.precio) byKey.set(snap.pala_id, snap)
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
    if (priceRef.precio_minimo > 0 && priceRef.precio_maximo / priceRef.precio_minimo > MAX_SPREAD) { _dbg.push(`spread|${pala.modelo}`); continue }

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

    const ratio = snap.precio / ref
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
      precio_actual:     snap.precio,
      precio_original:   snap.precio_original,
      precio_referencia: ref,
      descuento_pct,
      url_producto:      snap.url_producto,
      tienda:            fuente.nombre,
      tienda_slug:       fuente.slug,
      scraped_at:        snap.scraped_at,
      tag,
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
      total: chollos.length,
      chollos_count: chollos.filter(c => c.tag === 'CHOLLO').length,
      ofertas_count: chollos.filter(c => c.tag === 'OFERTA').length,
      updated_at: updatedAt,
      _dbg,
      _dbgMeta: { snapshots_raw: snapshots.length, after_dedup: byKey.size },
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  )
}
