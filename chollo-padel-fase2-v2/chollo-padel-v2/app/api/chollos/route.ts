/**
 * app/api/chollos/route.ts
 * GET /api/chollos
 *
 * Devuelve palas con bajada de precio considerable en tiendas físicas.
 * Cruza price_snapshots (precio actual) con price_reference (media 30 días).
 *
 * Umbrales:
 *   🔥 CHOLLO     ≥ 30% descuento sobre precio_referencia
 *   ⚡ OFERTA     ≥ 18% descuento sobre precio_referencia
 *
 * Solo snapshots de las últimas 24h (precios frescos del pipeline).
 * Deduplica por pala+tienda quedándose con el precio más bajo del día.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export interface CholloTienda {
  pala_id:           string
  modelo:            string
  marca:             string
  año:               number
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

const UMBRAL_CHOLLO = 0.70  // precio_actual ≤ 70% de referencia = ≥30% dto
const UMBRAL_OFERTA = 0.82  // precio_actual ≤ 82% de referencia = ≥18% dto
const MIN_REFERENCIA = 50   // ignorar palas con precio_referencia < 50€ (datos insuficientes)

// ─── Guardias de calidad de match ────────────────────────────────────────────
//
// El fuzzy matcher puede asignar incorrectamente un snapshot a una pala del
// catálogo con tokens similares pero año o modelo distintos. Estas guardias
// descartan falsos positivos en runtime sin tocar la BD.
//
// GUARDIA A — Año de 4 dígitos en URL ≠ año catálogo
//   "head-extreme-motion-2023" con pala.año=2026 → descartado
//
// GUARDIA B — Sufijo de 2 dígitos tipo -NN- en URL implica año distinto
//   "hack-hybrid-04-25-premier-padel" con pala.año=2026 → descartado
//   Solo actúa si NO hay año de 4 dígitos (ya cubierto por A).
//   El patrón evita falsos positivos en SKUs como -113778-p o -32311-p.
//
// GUARDIA C — Misma URL asignada a dos pala_ids distintos → ambigüedad
//   "drop-shot-axion-attack" matcheado a Soft 2026 Y a 2024 → ambos descartados
//   Si no podemos saber cuál es el correcto, no mostramos ninguno.
//
// GUARDIA D — Nombre de modelo en URL claramente distinto al del catálogo
//   "counter-origin" con pala.modelo="Counter Veron" → descartado
//   Lista explícita de colisiones conocidas del matcher.

// Colisiones conocidas: [fragmento_en_url, fragmento_en_modelo_catalogo]
// Si la URL contiene el primero pero el modelo contiene el segundo → falso positivo
const URL_MODEL_COLISIONES: [string, string][] = [
  ['counter-origin',  'counter veron'],   // Babolat Counter Origin ≠ Counter Veron
  ['counter-viper',   'counter veron'],   // Babolat Counter Viper ≠ Counter Veron
  ['extreme-motion',  'extreme tour'],    // Head Extreme Motion ≠ Extreme Tour
]

function esDescartadoPorGuardias(
  urlProducto: string,
  palaAño: number,
  palaModelo: string,
  urlsConMismaPala: Set<string>,  // otras URLs que apuntan al mismo pala_id
  palaIdsConMismaUrl: Set<string> // otros pala_ids que comparten esta URL
): string | null {

  const url = urlProducto.toLowerCase()

  // ── GUARDIA A: año de 4 dígitos en URL ───────────────────────────────────
  const m4 = url.match(/20(\d{2})/)
  if (m4) {
    const urlYear = parseInt(m4[0], 10)
    if (urlYear !== palaAño) {
      return `A: año URL ${urlYear} ≠ catálogo ${palaAño}`
    }
  }

  // ── GUARDIA B: sufijo de 2 dígitos tipo -NN- implica año ─────────────────
  // Solo si no hay año de 4 dígitos (guardia A ya lo cubriría).
  // Patrón: -NN- donde NN es 19-29, no seguido de más de 3 dígitos (evita SKUs)
  if (!m4) {
    const slug = url.split('/').filter(Boolean).pop() ?? url
    const m2 = slug.match(/-(1[9]|2[0-9])-(?!\d{3,})/)
    if (m2) {
      const shortYear = parseInt(m2[1], 10)
      const fullYear = 2000 + shortYear
      if (fullYear !== palaAño) {
        return `B: sufijo -${m2[1]}- en URL implica ${fullYear} ≠ catálogo ${palaAño}`
      }
    }
  }

  // ── GUARDIA C: URL compartida entre múltiples pala_ids ───────────────────
  // Si la misma URL está asignada a más de una pala, el matcher es ambiguo.
  // No podemos saber cuál es correcta → descartamos todos.
  if (palaIdsConMismaUrl.size > 1) {
    return `C: URL compartida con ${palaIdsConMismaUrl.size - 1} pala(s) más`
  }

  // ── GUARDIA D: colisión de nombre conocida ────────────────────────────────
  const modeloLower = palaModelo.toLowerCase()
  for (const [urlFrag, modelFrag] of URL_MODEL_COLISIONES) {
    if (url.includes(urlFrag) && modeloLower.includes(modelFrag)) {
      return `D: URL contiene "${urlFrag}" pero modelo es "${modelFrag}"`
    }
  }

  return null
}

export async function GET() {
  // 1. Snapshots de las últimas 24h con precio_referencia disponible
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // match_confidence >= 0.95: solo matches muy fiables.
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
    // PadelZoom (source_id=2) es un agregador, no una tienda real.
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

  // 2. Deduplicar por pala_id + source_id — quedarse con el precio más bajo del día
  const byKey = new Map<string, typeof snapshots[0]>()
  for (const snap of snapshots) {
    const key = `${snap.pala_id}__${snap.source_id}`
    const existing = byKey.get(key)
    if (!existing || snap.precio < existing.precio) {
      byKey.set(key, snap)
    }
  }

  // 3. Construir índices para guardias C:
  //    - por URL: qué pala_ids distintos apuntan a la misma URL
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

    const ref = pala.precio_referencia as number | null
    if (!ref || ref < MIN_REFERENCIA) continue

    const palaIdsEnEstaUrl = urlToPalaIds.get(snap.url_producto) ?? new Set([snap.pala_id])

    const motivo = esDescartadoPorGuardias(
      snap.url_producto,
      pala.año,
      pala.modelo,
      new Set(),       // urlsConMismaPala (no usado aún)
      palaIdsEnEstaUrl
    )

    if (motivo) {
      console.log(`[chollos:skip] ${motivo} | ${pala.modelo} | ${snap.url_producto.slice(-50)}`)
      continue
    }

    const ratio = snap.precio / ref
    if (ratio > UMBRAL_OFERTA) continue  // descuento insuficiente

    const descuento_pct = Math.round((1 - ratio) * 100)
    const tag: 'CHOLLO' | 'OFERTA' = ratio <= UMBRAL_CHOLLO ? 'CHOLLO' : 'OFERTA'

    chollos.push({
      pala_id:           snap.pala_id,
      modelo:            pala.modelo,
      marca:             pala.marca,
      año:               pala.año,
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

  // 5. Ordenar: primero CHOLLO, luego OFERTA; dentro de cada grupo por descuento desc
  chollos.sort((a, b) => {
    if (a.tag !== b.tag) return a.tag === 'CHOLLO' ? -1 : 1
    return b.descuento_pct - a.descuento_pct
  })

  return NextResponse.json(
    {
      chollos,
      total: chollos.length,
      chollos_count: chollos.filter(c => c.tag === 'CHOLLO').length,
      ofertas_count: chollos.filter(c => c.tag === 'OFERTA').length,
      updated_at: chollos[0]?.scraped_at ?? null,
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  )
}
