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

const CONDITION_REVERSE: Record<string, string> = {
  un_opened:        'new',
  new:              'new',
  as_good_as_new:   'as_good_as_new',
  good:             'good',
  fair:             'fair',
  has_given_it_all: 'fair',
}

export async function searchWallapop(
  query: string,
  maxPrice?: number,
  minPrice?: number,
  conditions?: string[]
): Promise<WallapopItem[]> {
  try {
    // Siempre UNA sola llamada a Apify, sin filtro de condición
    const input: any = {
      keyword: query,
      maxResults: 120,
      orderBy: 'most_relevance',
    }
    if (maxPrice !== undefined) input.maxPrice = maxPrice
    if (minPrice !== undefined) input.minPrice = minPrice

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

    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const seen = new Set<string>()

    return data
      .map((item: any) => {
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
          condition: '',  // Apify no devuelve condition, se deja vacío
          location: item.location?.city ?? '',
          city: item.location?.city ?? '',
          platform: 'wallapop',
          date: item.createdAt ? new Date(item.createdAt).toISOString() : '',
        }
      })
      .filter((item: WallapopItem) => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        const titleLower = item.title.toLowerCase()
        if (!words.every(w => titleLower.includes(w))) return false
        if (minPrice !== undefined && item.price < minPrice) return false
        if (maxPrice !== undefined && item.price > maxPrice) return false
        // Filtro de condición: si el usuario filtra por estado,
        // no podemos filtrarlo en Wallapop (no tenemos el dato)
        // así que se muestran todos igualmente
        return true
      })

  } catch (err) {
    console.error('Error en searchWallapop:', err)
    return []
  }
}
