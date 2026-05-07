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
      keyword: query,
      max_pages: 3,
    }
    if (maxPrice) input.max_price = maxPrice
    if (minPrice) input.min_price = minPrice
    if (conditions && conditions.length > 0) input.condition = conditions

    const res = await fetch(
      `https://api.apify.com/v2/acts/cptauad~wallapop-scraper/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=120`,
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
      // 🔍 LOG TEMPORAL — borrar una vez sepamos los valores reales
      console.log('ITEM RAW:', JSON.stringify({
        condition: item.condition,
        published_at: item.published_at,
        date: item.date,
        createdAt: item.createdAt,
        creation_date: item.creation_date,
        modification_date: item.modification_date,
        status: item.status,
        state: item.state,
      }))

      return {
        id: item.id ?? '',
        title: item.title ?? '',
        description: item.description ?? '',
        price: item.price ?? 0,
        currency: item.currency ?? 'EUR',
        images: item.image ? [item.image] : [],
        img: item.image ?? null,
        url: item.url ?? '',
        condition: item.condition ?? '',
        location: item.location?.city ?? '',
        city: item.location?.city ?? '',
        platform: 'wallapop',
        date: item.published_at ?? '',
      }
    })
  } catch (err) {
    console.error('Error en searchWallapop:', err)
    return []
  }
}
