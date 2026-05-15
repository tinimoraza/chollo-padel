import { createClient } from '@supabase/supabase-js'

export interface WallapopItem {
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

export type PalaItem = WallapopItem

const CONDITION_MAP: Record<string, string[]> = {
  new:            ['un_opened', 'new'],
  as_good_as_new: ['as_good_as_new'],
  good:           ['good'],
  fair:           ['fair', 'has_given_it_all'],
}

export async function searchWallapop(
  query: string,
  maxPrice?: number,
  minPrice?: number,
  conditions?: string[]
): Promise<WallapopItem[]> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )

    const words = query.toLowerCase().split(/\s+/).filter(Boolean)

    // ── Paso 1: buscar anuncios en wallapop_cache ──────────────────────────────
    let sb = supabase
      .from('wallapop_cache')
      .select('*')
      .order('price', { ascending: true })
      .limit(500)

    for (const word of words) {
      sb = sb.ilike('title', `%${word}%`)
    }

    if (minPrice !== undefined) sb = sb.gte('price', minPrice)
    if (maxPrice !== undefined) sb = sb.lte('price', maxPrice)

    if (conditions && conditions.length > 0) {
      const wallapopConditions = conditions.flatMap(c => CONDITION_MAP[c] ?? [])
      if (wallapopConditions.length > 0) {
        sb = sb.in('condition', wallapopConditions)
      }
    }

    const { data, error } = await sb

    if (error) {
      console.error('Error leyendo wallapop_cache de Supabase:', error)
      return []
    }

    if (!data || data.length === 0) return []

    // ── Paso 2: buscar precio_referencia Y precio_pvp para los pala_id ─────────
    const palaIdsSet: Record<string, boolean> = {}
    for (const item of data) {
      if (item.pala_id) palaIdsSet[item.pala_id] = true
    }
    const palaIds = Object.keys(palaIdsSet)
    const precioRefMap: Record<string, number> = {}

    if (palaIds.length > 0) {
      // precio_referencia de price_reference
      const { data: refs } = await supabase
        .from('price_reference')
        .select('pala_id, precio_referencia')
        .in('pala_id', palaIds)

      // precio_pvp de palas como fallback
      const { data: palas } = await supabase
        .from('palas')
        .select('id, precio_pvp')
        .in('id', palaIds)

      const pvpMap: Record<string, number> = {}
      if (palas) {
        for (const p of palas) {
          if (p.id && p.precio_pvp) pvpMap[p.id] = p.precio_pvp
        }
      }

      if (refs) {
        for (const r of refs) {
          if (!r.pala_id || !r.precio_referencia) continue
          const pvp = pvpMap[r.pala_id]

          // Si price_reference es sospechosa (< 50% del PVP), usar PVP
          if (pvp && r.precio_referencia < pvp * 0.5) {
            precioRefMap[r.pala_id] = pvp
          } else {
            precioRefMap[r.pala_id] = r.precio_referencia
          }
        }
      }

      // Palas sin price_reference → usar precio_pvp directamente
      for (const palaId of palaIds) {
        if (!precioRefMap[palaId] && pvpMap[palaId]) {
          precioRefMap[palaId] = pvpMap[palaId]
        }
      }
    }

    // ── Paso 3: combinar ───────────────────────────────────────────────────────
    return data.map((item) => ({
      id:                item.external_id,
      title:             item.title,
      description:       item.description ?? '',
      price:             item.price,
      currency:          item.currency ?? 'EUR',
      images:            item.img ? [item.img] : [],
      img:               item.img,
      url:               item.url,
      condition:         item.condition ?? '',
      location:          item.city ?? '',
      city:              item.city ?? '',
      platform:          'wallapop',
      date:              item.date ?? '',
      pala_id:           item.pala_id ?? null,
      precio_referencia: item.pala_id ? (precioRefMap[item.pala_id] ?? null) : null,
    }))

  } catch (err) {
    console.error('Error en searchWallapop:', err)
    return []
  }
}