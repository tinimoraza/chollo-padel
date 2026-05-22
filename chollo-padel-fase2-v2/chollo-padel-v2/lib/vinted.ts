/**
 * lib/vinted.ts
 * =============================================
 * Búsqueda de anuncios Vinted desde Supabase (wallapop_cache platform='vinted').
 * Los datos se mantienen frescos por scrape-vinted.ts (GH Actions cada hora a :30).
 * Incluye precio_referencia de tienda igual que Wallapop.
 */

import { createClient } from '@supabase/supabase-js'

export interface VintedItem {
  id: string
  title: string
  description: string
  price: number
  currency: string
  images: string[]
  url: string
  condition: string
  location: string
  city: string
  platform: string
  img: string | null
  date: string
  pala_id: string | null
  precio_referencia: number | null
}

const CONDITION_MAP: Record<string, string[]> = {
  new:            ['new'],
  as_good_as_new: ['as_good_as_new'],
  good:           ['good'],
  fair:           ['fair'],
}

export async function searchVinted(
  query: string,
  maxPrice?: number,
  minPrice?: number,
  conditions?: string[]
): Promise<VintedItem[]> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )

    const words = query.toLowerCase().split(/\s+/).filter(Boolean)

    // ── Paso 1: buscar en wallapop_cache platform='vinted' ────────────────────
    let sb = supabase
      .from('wallapop_cache')
      .select('*')
      .eq('platform', 'vinted')
      .order('price', { ascending: true })
      .limit(500)

    for (const word of words) {
      sb = sb.ilike('title', `%${word}%`)
    }

    if (minPrice !== undefined) sb = sb.gte('price', minPrice)
    if (maxPrice !== undefined) sb = sb.lte('price', maxPrice)

    if (conditions && conditions.length > 0) {
      const vintedConditions = conditions.flatMap(c => CONDITION_MAP[c] ?? [])
      if (vintedConditions.length > 0) {
        sb = sb.in('condition', vintedConditions)
      }
    }

    const { data, error } = await sb

    if (error) {
      console.error('Error leyendo Vinted de Supabase:', error)
      return []
    }

    if (!data || data.length === 0) return []

    // ── Paso 2: price_reference de tienda (igual que Wallapop) ───────────────
    const palaIdsSet: Record<string, boolean> = {}
    for (const item of data) {
      if (item.pala_id) palaIdsSet[item.pala_id] = true
    }
    const palaIds = Object.keys(palaIdsSet)
    const precioRefMap: Record<string, number> = {}

    if (palaIds.length > 0) {
      const { data: refs } = await supabase
        .from('price_reference')
        .select('pala_id, precio_referencia, fuentes_count')
        .in('pala_id', palaIds)

      if (refs) {
        for (const r of refs) {
          if (r.pala_id && r.precio_referencia && r.fuentes_count > 0) {
            precioRefMap[r.pala_id] = r.precio_referencia
          }
        }
      }
    }

    // ── Paso 3: combinar ──────────────────────────────────────────────────────
    return data.map((item) => ({
      id:                item.external_id,
      title:             item.title,
      description:       '',
      price:             item.price,
      currency:          item.currency ?? 'EUR',
      images:            item.img ? [item.img] : [],
      img:               item.img,
      url:               item.url,
      condition:         item.condition ?? '',
      location:          item.city ?? 'Europa',
      city:              item.city ?? 'Europa',
      platform:          'vinted',
      date:              item.date ?? '',
      pala_id:           item.pala_id ?? null,
      precio_referencia: item.pala_id ? (precioRefMap[item.pala_id] ?? null) : null,
    }))

  } catch (err) {
    console.error('Error en searchVinted:', err)
    return []
  }
}
