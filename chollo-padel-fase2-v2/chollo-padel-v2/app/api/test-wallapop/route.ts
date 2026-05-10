import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const params = new URLSearchParams({
    keywords:  'pala padel',
    latitude:  '40.4168',
    longitude: '-3.7038',
    order_by:  'newest',
    start:     '0',
    step:      '10',
  })

  const url = `https://api.wallapop.com/api/v3/general/search?${params}`

  const res = await fetch(url, {
    headers: {
      'Accept':          'application/json',
      'Accept-Language': 'es-ES,es;q=0.9',
      'DeviceOS':        '0',
      'MPlatform':       'WEB',
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  })

  return NextResponse.json({
    status: res.status,
    ok: res.ok,
    items: res.ok ? (await res.json())?.search_objects?.slice(0, 3) : [],
  })
}
