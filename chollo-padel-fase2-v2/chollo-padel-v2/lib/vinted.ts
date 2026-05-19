export interface VintedItem {
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

const CONDITION_MAP: Record<string, string[]> = {
  new:            ['6', '1'],
  as_good_as_new: ['2'],
  good:           ['3'],
  fair:           ['4'],
}

// Normaliza el valor crudo de item.status (ID numérico o label en español)
// al mismo sistema que usa wallapop_cache y SearchPanel
const CONDITION_NORMALIZE: Record<string, string> = {
  '6': 'new',
  '1': 'as_good_as_new',
  '2': 'good',
  '3': 'good',
  '4': 'fair',
  'Nuevo con etiquetas': 'new',
  'Nuevo sin etiquetas': 'as_good_as_new',
  'Muy bueno':           'good',
  'Bueno':               'good',
  'Satisfactorio':       'fair',
}

// Caché del token en memoria
let cachedAuth: { cookie: string; token: string; expiresAt: number } | null = null

async function getVintedToken(): Promise<{ cookie: string; token: string } | null> {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) {
    return { cookie: cachedAuth.cookie, token: cachedAuth.token }
  }
  try {
    const res = await fetch('https://www.vinted.es', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
    })

    const rawCookies = res.headers.getSetCookie?.() ?? []

    const cookie = rawCookies
      .map((c) => c.split(';')[0])
      .filter((c) => {
        const [, val] = c.split('=')
        return val && val.trim().length > 0
      })
      .join('; ')

    const tokenEntry = rawCookies
      .map((c) => c.split(';')[0])
      .find((c) => c.startsWith('access_token_web=') && c.length > 'access_token_web='.length + 5)

    const token = tokenEntry?.split('=').slice(1).join('=')
    if (!token) return null

    cachedAuth = { cookie, token, expiresAt: Date.now() + 5 * 60 * 1000 }
    return { cookie, token }
  } catch (err) {
    console.error('Error obteniendo token de Vinted:', err)
    return null
  }
}

export async function searchVinted(
  query: string,
  maxPrice?: number,
  minPrice?: number,
  conditions?: string[]
): Promise<VintedItem[]> {
  try {
    const auth = await getVintedToken()
    if (!auth) {
      console.error('No se pudo obtener token de Vinted')
      return []
    }

    const { cookie, token } = auth

    const statusIds: string[] = []
    if (conditions && conditions.length > 0) {
      for (const c of conditions) {
        const mapped = CONDITION_MAP[c]
        if (mapped) statusIds.push(...mapped)
      }
    }

    const params = new URLSearchParams({
      search_text: query,
      per_page: '120',
      order: 'newest_first',
    })

    if (minPrice !== undefined) params.set('price_from', String(minPrice))
    if (maxPrice !== undefined) params.set('price_to', String(maxPrice))
    for (const id of statusIds) {
      params.append('status_ids[]', id)
    }

    const res = await fetch(`https://www.vinted.es/api/v2/catalog/items?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Referer': 'https://www.vinted.es/',
        'Cookie': cookie,
        'Authorization': `Bearer ${token}`,
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error(`Vinted API error ${res.status}:`, errText)
      return []
    }

    const data = await res.json()
    const items: any[] = data.items ?? []
    console.log(`Vinted devolvió ${items.length} items para "${query}"`)

    const words = query.toLowerCase().split(/\s+/).filter(Boolean)

    return items
      .filter((item) => {
        const titleLower = (item.title ?? '').toLowerCase()
        return words.every((w) => titleLower.includes(w))
      })
      .map((item) => {
        const img = item.photo?.url ?? item.photos?.[0]?.url ?? null
        const ts = item.photo?.high_resolution?.timestamp
        const date = ts ? new Date(ts * 1000).toISOString() : ''
        const price = parseFloat(item.price?.amount ?? '0')

        return {
          id: String(item.id),
          title: item.title ?? '',
          description: '',
          price,
          currency: item.price?.currency_code ?? 'EUR',
          images: img ? [img] : [],
          img,
          url: item.url ?? `https://www.vinted.es/items/${item.id}`,
          condition: CONDITION_NORMALIZE[String(item.status ?? '')] ?? String(item.status ?? ''),
          location: 'Europa',
          city: 'Europa',
          platform: 'vinted',
          date,
        }
      })
  } catch (err) {
    console.error('Error en searchVinted:', err)
    return []
  }
}
