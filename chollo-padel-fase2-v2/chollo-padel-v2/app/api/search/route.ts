import { NextResponse } from 'next/server'
import { searchWallapop } from '@/lib/wallapop'
import { searchVinted } from '@/lib/vinted'
import { getCached, setCached } from '@/lib/cache'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()
  if (!q) return NextResponse.json([])

  const maxRaw = searchParams.get('max_price')
  const minRaw = searchParams.get('min_price')
  const maxPrice = maxRaw ? Number(maxRaw) : undefined
  const minPrice = minRaw ? Number(minRaw) : undefined
  const conditionsRaw = (searchParams.get('conditions') ?? '').trim()
  const conditions =
    conditionsRaw.length > 0
      ? conditionsRaw.split(',').map(s => s.trim()).filter(Boolean)
      : undefined
  const platformsRaw = (searchParams.get('platforms') ?? 'wallapop,vinted').trim()
  const platforms = platformsRaw.split(',').map(s => s.trim()).filter(Boolean)

  const maxP = Number.isFinite(maxPrice as number) ? maxPrice : undefined
  const minP = Number.isFinite(minPrice as number) ? minPrice : undefined

  // Base de la clave sin plataforma
  const baseKey = [
    q,
    maxP ?? '',
    minP ?? '',
    conditions?.sort().join('+') ?? '',
  ].join('|')

  async function fetchWithCache(
    platform: string,
    fetcher: () => Promise<any[]>
  ): Promise<any[]> {
    const key = `${platform}|${baseKey}`
    const cached = await getCached<any[]>(key)
    if (cached) {
      console.log(`Cache HIT [${platform}] "${baseKey}"`)
      return cached
    }
    console.log(`Cache MISS [${platform}] "${baseKey}"`)
    const results = await fetcher()
    setCached(key, results).catch(err => console.error(`Error caché [${platform}]:`, err))
    return results
  }

  const [wallapopResults, vintedResults] = await Promise.all([
    platforms.includes('wallapop')
      ? fetchWithCache('wallapop', () => searchWallapop(q, maxP, minP, conditions))
      : Promise.resolve([]),
    platforms.includes('vinted')
      ? fetchWithCache('vinted', () => searchVinted(q, maxP, minP, conditions))
      : Promise.resolve([]),
  ])

  const combined = [...wallapopResults, ...vintedResults]
    .sort((a, b) => a.price - b.price)

  return NextResponse.json(combined)
}
