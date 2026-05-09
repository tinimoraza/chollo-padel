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

  // Clave de caché única por combinación de parámetros
  const cacheKey = [
    q,
    platforms.sort().join('+'),
    maxP ?? '',
    minP ?? '',
    conditions?.sort().join('+') ?? '',
  ].join('|')

  // Intentar caché primero
  const cached = await getCached<any[]>(cacheKey)
  if (cached) {
    console.log(`Cache HIT para "${cacheKey}"`)
    return NextResponse.json(cached)
  }

  console.log(`Cache MISS para "${cacheKey}" — llamando a APIs`)

  const [wallapopResults, vintedResults] = await Promise.all([
    platforms.includes('wallapop') ? searchWallapop(q, maxP, minP, conditions) : Promise.resolve([]),
    platforms.includes('vinted')   ? searchVinted(q, maxP, minP, conditions)   : Promise.resolve([]),
  ])

  const combined = [...wallapopResults, ...vintedResults]
    .sort((a, b) => a.price - b.price)

  // Guardar en caché (sin await para no bloquear la respuesta)
  setCached(cacheKey, combined).catch(err =>
    console.error('Error guardando caché:', err)
  )

  return NextResponse.json(combined)
}
