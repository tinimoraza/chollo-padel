export interface PalaItem {
  id: string
  title: string
  price: number
  city: string
  condition: string
  platform: 'wallapop' | 'vinted'
  url: string
  img: string | null
  date: string
}

export async function searchWallapop(
  keywords: string,
  maxPrice?: number
): Promise<PalaItem[]> {
  const params = new URLSearchParams({
    source: 'web',
    keywords,
    latitude: '40.4168',
    longitude: '-3.7038',
    distance: '500000',
    category_ids: '17467',
    country_code: 'ES',
    language: 'es_ES',
    filters_source: 'quick_filters',
  })

  if (maxPrice) params.append('max_sale_price', String(maxPrice * 100))

  const res = await fetch(
    `https://api.wallapop.com/api/v3/general/search?${params}`,
    {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'es-ES,es;q=0.9',
        DeviceOS: '0',
        Origin: 'https://es.wallapop.com',
        Referer: 'https://es.wallapop.com/',
        'X-DeviceOS': '0',
      },
      next: { revalidate: 300 }, // cache 5 min en Next.js
    }
  )

  if (!res.ok) throw new Error(`Wallapop API error: ${res.status}`)

  const data = await res.json()
  const items = (data?.search_objects || []) as any[]

  return items.map((item) => ({
    id: item.id,
    title: item.content?.title || 'Sin título',
    price:
      Math.round((item.content?.price?.amount || 0) / 100) ||
      Math.round(item.content?.price?.amount || 0),
    city: item.location?.city || '',
    condition: item.content?.condition || '',
    platform: 'wallapop',
    url: `https://es.wallapop.com/item/${item.web_slug || item.id}`,
    img: item.content?.images?.[0]?.urls?.medium || null,
    date: item.content?.modified_date || '',
  }))
}
