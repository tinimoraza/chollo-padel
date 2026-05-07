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

    // 🔍 LOG TEMPORAL — item completo del primer resultado para ver todos los campos
    if (data.length > 0) {
      console.log('PRIMER ITEM COMPLETO:', JSON.stringify(data[0], null, 2))
    }

    return data.map((item: any) => ({
      id: item.id ?? '',
      title: item.title ?? '',
      description: item.description ?? '',
      price: item.price ?? 0,
      currency: item.currency ?? 'EUR',
      images: item.image ? [item.image] : [],
      img: item.image ?? null,
      url: item.url ?? '',
      condition: item.condition ?? '',
      location: item.location?.city ?? item.city ?? item.location ?? '',
      city: item.location?.city ?? item.city ?? item.location ?? '',
      platform: 'wallapop',
      date: item.published_at ?? item.created_at ?? item.date ?? '',
    }))
  } catch (err) {
    console.error('Error en searchWallapop:', err)
    return []
  }
}
