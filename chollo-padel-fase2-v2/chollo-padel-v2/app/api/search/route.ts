import { NextRequest, NextResponse } from 'next/server'
import { searchWallapop } from '@/lib/wallapop'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')
  const maxPrice = searchParams.get('max_price')
  const minPrice = searchParams.get('min_price')
  const condition = searchParams.get('condition')

  if (!q) {
    return NextResponse.json({ error: 'Falta el parámetro q' }, { status: 400 })
  }

  try {
    const items = await searchWallapop(
      q,
      maxPrice ? parseInt(maxPrice) : undefined,
      minPrice ? parseInt(minPrice) : undefined,
      condition ?? undefined
    )
    return NextResponse.json({ items, total: items.length })
  } catch (err) {
    console.error('Search error:', err)
    return NextResponse.json({ error: 'Error buscando en Wallapop' }, { status: 500 })
  }
}
