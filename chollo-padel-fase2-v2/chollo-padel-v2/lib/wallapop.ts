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

const CONDITION_MAP: Record<string, string> = {
  un_opened: 'un_opened',
  new: 'new',
  as_good_as_new: 'as_good_as_new',
  good: 'good',
  fair: 'fair',
  has_given_it_all: 'has_given_it_all',
}

export async function searchWallapop(
  query: string,
  maxPrice?: number,
  minPrice?: number,
  conditions?: string[]
): Promise<WallapopItem[]> {
  try {
    const allItems: WallapopItem[] = []

    // Si hay conditions, hacemos una llamada por cada una y combinamos
    // Si no hay conditions, hacemos una sola llamada sin filtro
    const conditionList =
      conditions && conditions.length > 0 ? conditions : [undefined]

    await Promise.all(
      conditionList.map(async (condition) => {
        const params = new URLSearchParams({
          keywords: query,
          language: 'es_ES',
          filters_source: 'quick_filters',
          order_by: 'newest',
        })

        if (maxPrice !== undefined) params.set('max_sale_price', String(maxPrice))
        if (minPrice !== undefined) params.set('min_sale_price', String(minPrice))
        if (condition) params.set('condition', condition)

        const url = `https://api.wallapop.com/api/v3/general/search?${params.toString()}`

        const res = await fetch(url, {
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'es-ES,es;q=0.9',
            'User-Agent':
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
            'X-AppVersion': '67900',
            'X-DeviceOS': '0',
          },
          cache: 'no-store',
        })

        if (!res.ok) {
          console.error(`Wallapop API error ${res.status} para condition=${condition}`)
          return
        }

        const data = await res.json()

        // 🔍 LOG TEMPORAL — ver estructura del primer item
        if (data?.search_objects?.[0]) {
          console.log('PRIMER ITEM WALLAPOP:', JSON.stringify(data.search_objects[0], null, 2))
        }

        const items: WallapopItem[] = (data?.search_objects ?? []).map((item: any) => {
          const img =
            item.main_image_url ??
            item.images?.[0]?.urls?.medium ??
            item.images?.[0]?.urls?.small ??
            null

          const url = item.web_slug
            ? `https://es.wallapop.com/item/${item.web_slug}`
            : `https://es.wallapop.com/item/${item.id}`

          return {
            id: item.id ?? '',
            title: item.title ?? '',
            description: item.description ?? '',
            price: item.sale_price ?? item.price ?? 0,
            currency: item.currency ?? 'EUR',
            images: img ? [img] : [],
            img,
            url,
            condition: item.condition ?? '',
            location: item.location?.city ?? '',
            city: item.location?.city ?? '',
            platform: 'wallapop',
            date: item.creation_date
              ? new Date(item.creation_date * 1000).toISOString()
              : '',
          }
        })

        allItems.push(...items)
      })
    )

    // Deduplicar por id en caso de llamadas múltiples
    const seen = new Set<string>()
    return allItems.filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
  } catch (err) {
    console.error('Error en searchWallapop:', err)
    return []
  }
}
