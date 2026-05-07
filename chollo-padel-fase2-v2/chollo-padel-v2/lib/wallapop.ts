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
    // Si hay conditions hacemos una llamada por cada una en paralelo
    // Si no hay conditions hacemos una sola llamada sin filtro
    const conditionList =
      conditions && conditions.length > 0 ? conditions : [undefined]

    const results = await Promise.all(
      conditionList.map(async (condition) => {
        const input: any = {
          keyword: query,
          maxResults: 120,
          orderBy: 'newest',
        }

        if (maxPrice !== undefined) input.maxPrice = maxPrice
        if (minPrice !== undefined) input.minPrice = minPrice
        if (condition) input.condition = condition

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
          console.error(`Apify error ${res.status} para condition=${condition}:`, errText)
          return []
        }

        const data = await res.json()
        console.log(`Apify devolvió ${data.length} items para "${query}" condition=${condition ?? 'todas'}`)

        return data.map((item: any) => ({
          id: item.id ?? '',
          title: item.title ?? '',
          description: item.description ?? '',
          price: item.price ?? 0,
          currency: item.currency ?? 'EUR',
          images: item.images?.[0]?.urls?.medium ? [item.images[0].urls.medium] : [],
          img: item.imageUrl ?? item.images?.[0]?.urls?.medium ?? null,
          url: item.productUrl ?? `https://es.wallapop.com/item/${item.webSlug}` ?? '',
          // Asignamos la condition que usamos como filtro — todos los resultados la tienen
          condition: condition ?? '',
          location: item.location?.city ?? '',
          city: item.location?.city ?? '',
          platform: 'wallapop',
          date: item.createdAt
            ? new Date(item.createdAt).toISOString()
            : '',
        }))
      })
    )

    // Aplanar y deduplicar por id
    const seen = new Set<string>()
    return results
      .flat()
      .filter((item) => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
      })
  } catch (err) {
    console.error('Error en searchWallapop:', err)
    return []
  }
}
