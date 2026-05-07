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

function buildWallapopUrl(item: any): string {
  const slug = item.web_slug ?? item.webSlug ?? item.slug ?? null
  if (slug) return `https://es.wallapop.com/item/${slug}`
  const titleSlug = (item.title ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
  const id = item.id ?? ''
  if (titleSlug && id) return `https://es.wallapop.com/item/${titleSlug}-${id}`
  return `https://es.wallapop.com/item/${id}`
}

export async function searchWallapop(
  query: string,
  maxPrice?: number,
  minPrice?: number
): Promise<WallapopItem[]> {
  try {
    const input: any = {
      keywords: query,
      maxResults: 0,
    }
    if (maxPrice) input.maxPrice = maxPrice
    if (minPrice) input.minPrice = minPrice

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
      const cityName = item.location?.city ?? item.city?.city ?? ''
      const allImages = (item.images ?? []).map((img: any) => img.urls?.medium ?? img.urls?.small ?? '')
      const firstImg = allImages[0] ?? null
      const price = item.price?.amount ?? item.price ?? 0

      return {
        id: item.id ?? '',
        title: item.title ?? '',
        description: item.description ?? '',
        price,
        currency: item.price?.currency ?? 'EUR',
        images: allImages,
        img: firstImg,
        url: buildWallapopUrl(item),
        condition: item.condition ?? '',
        location: cityName,
        city: cityName,
        platform: 'wallapop',
        date: item.creation_date ?? item.modification_date ?? item.published_at ?? item.createdAt ?? '',
      }
    })
  } catch (err) {
    console.error('Error en searchWallapop:', err)
    return []
  }
}
