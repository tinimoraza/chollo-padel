/**
 * lib/wallapop.ts — SIN APIFY
 * Lee de la tabla wallapop_cache en Supabase.
 * Los datos los rellena el GitHub Action que corre cada hora.
 * La interfaz es idéntica a la anterior → route.ts no cambia.
 */

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
}

export type PalaItem = WallapopItem

const CONDITION_MAP: Record<string, string[]> = {
  new:           ['un_opened', 'new'],
  as_good_as_new: ['as_good_as_new'],
  good:          ['good'],
  fair:          ['fair', 'has_given_it_all'],
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

    let sb = supabase
      .from('wallapop_cache')
      .select('*')
      .order('price', { ascending: true })
      .limit(200)

    if (minPrice !== undefined) sb = sb.gte('price', minPrice)
    if (maxPrice !== undefined) sb = sb.lte('price', maxPrice)

    if (conditions && conditions.length > 0) {
      const wallapopConditions = conditions.flatMap(c => CONDITION_MAP[c] ?? [])
      if (wallapopConditions.length > 0) {
        sb = sb.in('condition', wallapopConditions)
      }
    }

    const { data, error } = await sb

    console.log('[DEBUG wallapop] error:', error)
    console.log('[DEBUG wallapop] data length:', data?.length)
    console.log('[DEBUG wallapop] data:', JSON.stringify(data))

    if (error) {
      console.error('Error leyendo wallapop_cache de Supabase:', error)
      return []
    }

    if (!data || data.length === 0) return []

    const words = query.toLowerCase().split(/\s+/).filter(Boolean)

    return data
      .filter((item) => {
        const titleLower = (item.title ?? '').toLowerCase()
        return words.every((w) => titleLower.includes(w))
      })
      .map((item) => ({
        id:          item.external_id,
        title:       item.title,
        description: item.description ?? '',
        price:       item.price,
        currency:    item.currency ?? 'EUR',
        images:      item.img ? [item.img] : [],
        img:         item.img,
        url:         item.url,
        condition:   item.condition ?? '',
        location:    item.city ?? '',
        city:        item.city ?? '',
        platform:    'wallapop',
        date:        item.date ?? '',
      }))

  } catch (err) {
    console.error('Error en searchWallapop:', err)
    return []
  }
}
