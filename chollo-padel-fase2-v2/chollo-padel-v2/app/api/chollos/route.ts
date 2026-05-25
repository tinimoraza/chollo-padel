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

export async function GET() {
  // 1. Snapshots de las últimas 24h con precio_referencia disponible
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

  // 3. Filtrar por descuento significativo
  const chollos: CholloTienda[] = []

  for (const snap of byKey.values()) {
    const pala = snap.palas as any
    const fuente = snap.price_sources as any

    if (!pala || !fuente) continue

    const ref = pala.precio_referencia as number | null
    if (!ref || ref < MIN_REFERENCIA) continue

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

  // 4. Ordenar: primero CHOLLO, luego OFERTA; dentro de cada grupo por descuento desc
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
