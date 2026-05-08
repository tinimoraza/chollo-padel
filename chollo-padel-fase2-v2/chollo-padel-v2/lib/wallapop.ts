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

// Mapeo de estados normalizados → valores internos de Wallapop
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
    // Traducir condiciones normalizadas a valores de Wallapop
    let wallapopConditions: (string | undefined)[]
    if (conditions && conditions.length > 0) {
      const mapped = conditions.flatMap(c => CONDITION_MAP[c] ?? [])
      wallapopConditions = mapped.length > 0 ? mapped : [undefined]
    } else {
      wallapopConditions = [undefined]
    }

    const results = await Promise.all(
      wallapopConditions.map(async (condition) => {
        const input: any = {
          keyword: query,
          maxResults: 120,
          orderBy: 'most_relevance',
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

        return data.map((item: any) => {
          const img = item.imageUrl ?? item.images?.[0]?.urls?.medium ?? null
          const url = item.productUrl
            ? String(item.productUrl)
            : `https://es.wallapop.com/item/${item.webSlug ?? item.id}`
          return {
            id: item.id ?? '',
            title: item.title ?? '',
            description: item.description ?? '',
            price: item.price ?? 0,
            currency: item.currency ?? 'EUR',
            images: img ? [img] : [],
            img,
            url,
            condition: condition ?? '',
            location: item.location?.city ?? '',
            city: item.location?.city ?? '',
            platform: 'wallapop',
            date: item.createdAt
              ? new Date(item.createdAt).toISOString()
              : '',
          }
        })
      })
    )

    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const seen = new Set<string>()

    return results
      .flat()
      .filter((item) => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        const titleLower = item.title.toLowerCase()
        if (!words.every(w => titleLower.includes(w))) return false
        if (minPrice !== undefined && item.price < minPrice) return false
        if (maxPrice !== undefined && item.price > maxPrice) return false
        return true
      })
  } catch (err) {
    console.error('Error en searchWallapop:', err)
    return []
  }
}
