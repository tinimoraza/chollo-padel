import { NextRequest, NextResponse } from 'next/server'
import { searchWallapop } from '@/lib/wallapop'

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const q = searchParams.get('q')
  const maxPriceRaw = searchParams.get('max_price')
  const minPriceRaw = searchParams.get('min_price')
  const conditionsRaw = searchParams.get('conditions')

  if (!q) {
    return NextResponse.json({ error: 'Missing query param q' }, { status: 400 })
  }

  const maxPrice = maxPriceRaw ? Number(maxPriceRaw) : undefined
  const minPrice = minPriceRaw ? Number(minPriceRaw) : undefined
  const conditions = conditionsRaw
    ? conditionsRaw.split(',').filter(Boolean)
    : undefined

  const results = await searchWallapop(q, maxPrice, minPrice, conditions)

  return NextResponse.json(results)
}
