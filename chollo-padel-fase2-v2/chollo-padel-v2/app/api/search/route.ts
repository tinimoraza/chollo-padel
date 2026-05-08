import { NextResponse } from 'next/server'
import { searchWallapop } from '@/lib/wallapop'
import { searchVinted } from '@/lib/vinted'

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

  // Plataformas activas (el frontend mandará platforms=wallapop,vinted)
  const platformsRaw = (searchParams.get('platforms') ?? 'wallapop,vinted').trim()
  const platforms = platformsRaw.split(',').map(s => s.trim()).filter(Boolean)

  const maxP = Number.isFinite(maxPrice as number) ? maxPrice : undefined
  const minP = Number.isFinite(minPrice as number) ? minPrice : undefined

  // Llamadas en paralelo, solo a las plataformas activas
  const [wallapopResults, vintedResults] = await Promise.all([
    platforms.includes('wallapop') ? searchWallapop(q, maxP, minP, conditions) : Promise.resolve([]),
    platforms.includes('vinted')   ? searchVinted(q, maxP, minP, conditions)   : Promise.resolve([]),
  ])

  // Mezclar y ordenar por precio ascendente
  const combined = [...wallapopResults, ...vintedResults]
    .sort((a, b) => a.price - b.price)

  return NextResponse.json(combined)
}
