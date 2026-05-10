import { NextResponse } from 'next/server'
import { createHmac } from 'crypto'

export const dynamic = 'force-dynamic'

function getSignature(url: string, method: string, timestamp: number): string {
  const SECRET = 'Tm93IHRoYXQgeW91J3ZlIGZvdW5kIHRoaXMsIGFyZSB5b3UgcmVhZHkgdG8gam9pbiB1cz8gam9ic0B3YWxsYXBvcC5jb20=='
  const data = [method, url, timestamp].join('|') + '|'
  return createHmac('sha256', SECRET).update(data).digest('base64')
}

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
  const timestamp = Date.now()
  const signature = getSignature(url, 'GET', timestamp)

  const res = await fetch(url, {
    headers: {
      'Accept':          'application/json',
      'Accept-Language': 'es-ES,es;q=0.9',
      'DeviceOS':        '0',
      'MPlatform':       'WEB',
      'X-Signature':     signature,
      'TimestampControl': String(timestamp),
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  })

  return NextResponse.json({
    status: res.status,
    ok: res.ok,
    items: res.ok ? (await res.json())?.search_objects?.slice(0, 3) : [],
  })
}
