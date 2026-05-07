import { NextResponse } from 'next/server'
import { searchWallapop } from '@/lib/wallapop'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const q = (searchParams.get('q') ?? '').trim()
  if (!q) return NextResponse.json([])

  const maxRaw = searchParams.get('max_price')
  const minRaw = searchParams.get('min_price')

  const maxPrice = maxRaw ? Number(maxRaw) : undefined
  const minPrice = minRaw ? Number(minRaw) : undefined

  // Frontend manda: conditions=good,fair,as_good_as_new
  const conditionsRaw = (searchParams.get('conditions') ?? '').trim()
  const conditions =
    conditionsRaw.length > 0
      ? conditionsRaw.split(',').map(s => s.trim()).filter(Boolean)
      : undefined

  const data = await searchWallapop(
    q,
    Number.isFinite(maxPrice as number) ? maxPrice : undefined,
    Number.isFinite(minPrice as number) ? minPrice : undefined,
    conditions
  )

  return NextResponse.json(data)
}
