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
      maxResults: 120,
      orderBy: 'newest',
    }

    if (maxPrice) input.maxPrice = maxPrice
    if (minPrice) input.minPrice = minPrice

    // Este actor solo acepta una condition — si hay varias las filtramos client-side después
    // Si solo hay una la mandamos al actor para aprovechar el filtro server-side
    if (conditions && conditions.length === 1) {
      input.condition = conditions[0]
    }

    const res = await fetch(
      `https://api.apify.com/v2/acts/alvaraaz~wallapop-product-search/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=120`,
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

    // 🔍 LOG TEMPORAL — ver estructura del primer item
    if (data.length > 0) {
      console.log('PRIMER ITEM COMPLETO:', JSON.stringify(data[0], null, 2))
    }

    const mapped = data.map((item: any) => ({
      id: item.id ?? '',
      title: item.title ?? '',
      description: item.description ?? '',
      price: item.price ?? 0,
      currency: item.currency ?? 'EUR',
      images: item.image ? [item.image] : [],
      img: item.image ?? null,
      url: item.url ?? item.itemUrl ?? '',
      condition: item.condition ?? '',
      location: item.location ?? item.city ?? '',
      city: item.city ?? item.location ?? '',
      platform: 'wallapop',
      date: item.publishedAt ?? item.createdAt ?? item.date ?? '',
    }))

    // Filtro client-side cuando hay múltiples conditions seleccionadas
    if (conditions && conditions.length > 1) {
      return mapped.filter((item: WallapopItem) =>
        conditions.includes(item.condition)
      )
    }

    return mapped
  } catch (err) {
    console.error('Error en searchWallapop:', err)
    return []
  }
}
