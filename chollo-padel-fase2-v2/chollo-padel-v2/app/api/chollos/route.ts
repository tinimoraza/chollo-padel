/**
 * app/api/chollos/route.ts
 * GET /api/chollos
 *
 * Devuelve palas con bajada de precio considerable en tiendas físicas.
 * Cruza price_snapshots (precio actual) con price_reference (media 30 días).
 *
 * Umbrales:
 *   CHOLLO     >= 30% descuento sobre precio_referencia
 *   OFERTA     >= 18% descuento sobre precio_referencia
 *
 * Solo snapshots de las últimas 24h (precios frescos del pipeline).
 * Deduplica por pala+tienda quedándose con el precio más bajo del día.
 *
 * Requisitos de calidad:
 *   - price_reference.fuentes_count >= MIN_FUENTES (>=2 tiendas) para que
 *     la referencia sea fiable. Una referencia de 1 sola tienda puede estar
 *     inflada o ser de una edición diferente del modelo -> false positives.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export interface CholloTienda {
  pala_id:           string
  modelo:            string
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

const UMBRAL_CHOLLO = 0.70  // precio_actual <= 70% de referencia = >=30% dto
const UMBRAL_OFERTA = 0.82  // precio_actual <= 82% de referencia = >=18% dto
const MIN_REFERENCIA = 50   // ignorar palas con precio_referencia < 50 (datos insuficientes)
const MIN_FUENTES = 2       // referencia valida solo si viene de >=2 tiendas distintas
const MAX_SPREAD  = 2.5     // si precio_maximo/precio_minimo > 2.5, datos contaminados por bad matches

// Colisiones conocidas: [fragmento_en_url, fragmento_en_modelo_catalogo]
const URL_MODEL_COLISIONES: [string, string][] = [
  ['counter-origin',  'counter veron'],
  ['counter-viper',   'counter veron'],
  ['extreme-motion',  'extreme tour'],
]

function esDescartadoPorGuardias(
  urlProducto: string,
  palaAno: number,
  palaModelo: string,
  urlsConMismaPala: Set<string>,
  palaIdsConMismaUrl: Set<string>
): string | null {

  const url = urlProducto.toLowerCase()

  // GUARDIA A: anyo de 4 digitos en URL
  const m4 = url.match(/20(\d{2})/)
  if (m4) {
    const urlYear = parseInt(m4[0], 10)
    if (urlYear !== palaAno) {
      return `A: anyo URL ${urlYear} != catalogo ${palaAno}`
    }
  }

  // GUARDIA B: sufijo de 2 digitos tipo -NN- implica anyo
  if (!m4) {
    const slug = url.split('/').filter(Boolean).pop() ?? url
    const m2 = slug.match(/-(1[9]|2[0-9])-(?!\d{3,})/)
    if (m2) {
      const shortYear = parseInt(m2[1], 10)
      const fullYear = 2000 + shortYear
      if (fullYear !== palaAno) {
        return `B: sufijo -${m2[1]}- en URL implica ${fullYear} != catalogo ${palaAno}`
      }
    }
  }

  // GUARDIA C: URL compartida entre multiples pala_ids
  if (palaIdsConMismaUrl.size > 1) {
    return `C: URL compartida con ${palaIdsConMismaUrl.size - 1} pala(s) mas`
  }

  // GUARDIA D: colision de nombre conocida
  const modeloLower = palaModelo.toLowerCase()
  for (const [urlFrag, modelFrag] of URL_MODEL_COLISIONES) {
    if (url.includes(urlFrag) && modeloLower.includes(modelFrag)) {
      return `D: URL contiene "${urlFrag}" pero modelo es "${modelFrag}"`
    }
  }

  // GUARDIA E: codigo de anyo de Padel Pro Shop (-NNN al final de la URL)
  // padelproshop.com usa sufijos como -224 (=2024), -225 (=2025), -226 (=2026).
  // Si el anyo codificado no coincide con el anyo del catalogo, es un match incorrecto.
  if (url.includes('padelproshop.com')) {
    const mCode = url.match(/-(2\d{2})(?:[^\d]|$)/)
    if (mCode) {
      const codeYear = 2000 + parseInt(mCode[1].slice(1), 10)
      if (codeYear !== palaAno) {
        return `E: codigo padelproshop -${mCode[1]} = ${codeYear} != catalogo ${palaAno}`
      }
    }
  }

  return null
}

export async function GET() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

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
      palas (*)
    `)
    .eq('disponible', true)
    .gte('scraped_at', since)
    .gte('match_confidence', 0.95)
    .neq('source_id', 2)
    .order('scraped_at', { ascending: false })

  if (error) {
    console.error('[api/chollos] Error:', error.message)
    return NextResponse.json({ error: 'Error cargando chollos' }, { status: 500 })
  }

  if (!snapshots || snapshots.length === 0) {
    return NextResponse.json(
      { chollos: [], updated_at: null },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  // 2. Deduplicar por pala_id + source_id — precio mas bajo del dia
  const byKey = new Map<string, typeof snapshots[0]>()
  for (const snap of snapshots) {
    const key = `${snap.pala_id}__${snap.source_id}`
    const existing = byKey.get(key)
    if (!existing || snap.precio < existing.precio) {
      byKey.set(key, snap)
    }
  }

  // 3a. Cargar price_reference para los pala_ids presentes.
  //     Usamos price_reference (no palas.precio_referencia) para:
  //       - tener el valor actualizado (sin desync entre tablas)
  //       - filtrar referencias con fuentes_count < MIN_FUENTES
  const palaIdsPresentes = Array.from(new Set(Array.from(byKey.values()).map(s => s.pala_id)))
  const { data: priceRefs } = await supabaseAdmin
    .from('price_reference')
    .select('pala_id, precio_referencia, fuentes_count, precio_minimo, precio_maximo')
    .in('pala_id', palaIdsPresentes)

  const priceRefMap = new Map<string, { precio_referencia: number; fuentes_count: number; precio_minimo: number; precio_maximo: number }>(
    (priceRefs ?? []).map(r => [
      r.pala_id,
      {
        precio_referencia: Number(r.precio_referencia),
        fuentes_count:     r.fuentes_count,
        precio_minimo:     Number(r.precio_minimo),
        precio_maximo:     Number(r.precio_maximo),
      },
    ])
  )

  // 3b. Indices para guardia C: URL -> pala_ids
  const urlToPalaIds = new Map<string, Set<string>>()
  for (const snap of Array.from(byKey.values())) {
    const url = snap.url_producto
    if (!urlToPalaIds.has(url)) urlToPalaIds.set(url, new Set())
    urlToPalaIds.get(url)!.add(snap.pala_id)
  }

  // 4. Filtrar aplicando guardias + umbral de descuento
  const chollos: CholloTienda[] = []

  for (const snap of Array.from(byKey.values())) {
    const pala = snap.palas as any
    const fuente = snap.price_sources as any

    if (!pala || !fuente) continue

    // Referencia desde price_reference (no palas.precio_referencia)
    const priceRef = priceRefMap.get(snap.pala_id)
    if (!priceRef) continue

    // Minimo MIN_FUENTES tiendas — una sola fuente puede estar inflada
    if (priceRef.fuentes_count < MIN_FUENTES) continue

    // Spread maximo: si max/min > MAX_SPREAD, la referencia esta contaminada por bad matches
    // (p.ej. varias palas distintas matcheadas al mismo pala_id con precios muy dispares)
    if (priceRef.precio_minimo > 0 && priceRef.precio_maximo / priceRef.precio_minimo > MAX_SPREAD) continue

    const ref = priceRef.precio_referencia
    if (!ref || ref < MIN_REFERENCIA) continue

    const palaIdsEnEstaUrl = urlToPalaIds.get(snap.url_producto) ?? new Set([snap.pala_id])

    const motivo = esDescartadoPorGuardias(
      snap.url_producto,
      pala['año'],
      pala.modelo,
      new Set(),
      palaIdsEnEstaUrl
    )

    if (motivo) {
      console.log(`[chollos:skip] ${motivo} | ${pala.modelo} | ${snap.url_producto.slice(-50)}`)
      continue
    }

    const ratio = snap.precio / ref
    if (ratio > UMBRAL_OFERTA) continue

    const descuento_pct = Math.round((1 - ratio) * 100)
    const tag: 'CHOLLO' | 'OFERTA' = ratio <= UMBRAL_CHOLLO ? 'CHOLLO' : 'OFERTA'

    chollos.push({
      pala_id:           snap.pala_id,
      modelo:            pala.modelo,
      marca:             pala.marca,
      ano:               pala['año'],
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

  // 5. Ordenar: CHOLLO primero, luego por descuento desc
  chollos.sort((a, b) => {
    if (a.tag !== b.tag) return a.tag === 'CHOLLO' ? -1 : 1
    return b.descuento_pct - a.descuento_pct
  })

  // updated_at = scraped_at mas reciente (no el del mayor descuento)
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
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  )
}
