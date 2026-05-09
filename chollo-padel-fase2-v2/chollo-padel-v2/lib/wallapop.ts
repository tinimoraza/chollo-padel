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
  new:            ['un_opened', 'new'],
  as_good_as_new: ['as_good_as_new'],
  good:           ['good'],
  fair:           ['fair', 'has_given_it_all'],
}

// Extrae condition.value del HTML de un item de Wallapop
async function fetchWallapopCondition(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return ''
    const html = await res.text()
    const match = html.match(/"condition"\s*:\s*\{[^}]*"value"\s*:\s*"([^"]+)"/)
    return match ? match[1] : ''
  } catch {
    return ''
  }
}

// Ejecuta promesas en lotes de N en paralelo
async function batchRun<T>(items: T[], fn: (item: T) => Promise<string>, batchSize: number): Promise<string[]> {
  const results: string[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
  }
  return results
}

export async function searchWallapop(
  query: string,
  maxPrice?: number,
  minPrice?: number,
  conditions?: string[]
): Promise<WallapopItem[]> {
  try {
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

        const words = query.toLowerCase().split(/\s+/).filter(Boolean)
        const seen = new Set<string>()

        // Filtrar primero antes de enriquecer
        const filtered = data.filter((item: any) => {
          if (!item.id || seen.has(item.id)) return false
          seen.add(item.id)
          const titleLower = (item.title ?? '').toLowerCase()
          if (!words.every(w => titleLower.includes(w))) return false
          if (minPrice !== undefined && (item.price ?? 0) < minPrice) return false
          if (maxPrice !== undefined && (item.price ?? 0) > maxPrice) return false
          return true
        })

        // Mapear a objetos base
        const mapped: WallapopItem[] = filtered.map((item: any) => {
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
            condition: condition ?? '', // temporal, se enriquece abajo
            location: item.location?.city ?? '',
            city: item.location?.city ?? '',
            platform: 'wallapop',
            date: item.createdAt ? new Date(item.createdAt).toISOString() : '',
          }
        })

        // Enriquecer condición en lotes de 10 (evitar sobrecarga)
        const conditions_fetched = await batchRun(
          mapped,
          (item) => fetchWallapopCondition(item.url),
          10
        )

        return mapped.map((item, i) => ({
          ...item,
          condition: conditions_fetched[i] || condition || '',
        }))
      })
    )

    const finalSeen = new Set<string>()
    return results.flat().filter(item => {
      if (finalSeen.has(item.id)) return false
      finalSeen.add(item.id)
      return true
    })

  } catch (err) {
    console.error('Error en searchWallapop:', err)
    return []
  }
}
