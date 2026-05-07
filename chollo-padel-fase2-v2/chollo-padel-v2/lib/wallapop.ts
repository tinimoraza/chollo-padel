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

export async function searchWallapop(
  query: string,
  maxPrice?: number,
  minPrice?: number,
  conditions?: string[]
): Promise<WallapopItem[]> {
  try {
    const input: any = {
      search_keyword: query,
      max_pages: 3,
    }
    if (maxPrice) input.max_price = maxPrice
    if (minPrice) input.min_price = minPrice

    const res = await fetch(
      `https://api.apify.com/v2/acts/data_alchemist~wallapop-search/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=120`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        cache: 'no-store',
      }
    )

    if (!res.ok) {
      const errText = await res.text()
      console.error(`Apify error ${res.status}:`, errText)
      return []
    }

    const data = await res.json()
    console.log(`Apify devolvió ${data.length} items para "${query}"`)

    return data.map((item: any) => {
      // 🔍 LOG TEMPORAL — borrar una vez sepamos los campos reales
      console.log('ITEM RAW COMPLETO:', JSON.stringify(item))

      return {
        id: item.id ?? '',
        title: item.title ?? '',
        description: item.description ?? '',
        price: item.price ?? 0,
        currency: item.currency ?? 'EUR',
        images: item.images?.[0] ? [item.images[0]] : [],
        img: item.images?.[0] ?? item.image ?? null,
        url: item.url ?? item.web_slug ?? '',
        condition: item.condition ?? '',
        location: item.location?.city ?? item.city ?? '',
        city: item.location?.city ?? item.city ?? '',
        platform: 'wallapop',
        date: item.creation_date ?? item.published_at ?? item.createdAt ?? '',
      }
    })
  } catch (err) {
    console.error('Error en searchWallapop:', err)
    return []
  }
}
