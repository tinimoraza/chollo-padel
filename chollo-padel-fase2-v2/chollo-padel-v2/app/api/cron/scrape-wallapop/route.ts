/**
 * app/api/cron/scrape-wallapop/route.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const MAX_RESULTS_PER_KEYWORD = 40

const KEYWORDS = [
  'pala padel', 'pala babolat', 'pala nox', 'pala head padel',
  'pala wilson padel', 'pala bullpadel', 'pala adidas padel',
  'pala siux', 'pala drop shot', 'pala starvie', 'pala vibora padel', 'pala dunlop padel',
]

const EXCLUIR_SCRAPER = [
  'raqueta tenis', 'raquetas tenis', 'tenis head', 'tenis wilson',
  'pro staff', 'blade v8', 'blade v9', 'blade v10', 'blade 98', 'blade 100',
  'pure drive', 'pure aero', 'pure strike', 'radical mp', 'ultra 98',
  'hierros', 'driver golf', 'speedback', 'putter', 'madera golf',
  'bolas de golf', 'bolas golf', ' golf ', 'pickleball', 'blade pro v',
  'esquís', 'esqui ', 'snowboard', 'ski ',
  'raqueta badminton', 'raqueta squash', 'hockey hierba', 'hockey hielo',
  'máquina padel', 'lanzadora', 'maquina padel',
  'lote palas', 'lote pádel', 'conjunto padel', 'set padel',
  '2 palas', '2 raquetas', '3 palas', '4 palas',
  'camiseta', 'camisetas', ' talla ', 'talla s', 'talla m', 'talla l', 'talla xl',
  'talla xs', 'zapatilla', 'zapatillas', 'botas ', 'botines', 'calcetines',
  'pantalon', 'pantalón', 'chaqueta', 'sudadera', 'equipacion', 'equipación',
  'chandal', 'chándal', 'shorts', 'polo ',
  'pelotas', 'pelota ', 'bolas ', ' bolas', 'balón', 'balon ',
  'mochila', 'paletero', 'bolsa ', ' bolsa', 'grip ', 'overgrip',
  'protector', 'muñequera', 'munequera', 'presurizador',
  'mundial', 'euro 20', 'champions', 'match worn', 'player version',
  'original históri', 'original histori', 'camp nou',
  'lote ', '+ accesorios', 'y accesorios', 'con accesorios',
]

const MARCAS = [
  { regex: /bullpadel/i,             marca: 'Bullpadel'   },
  { regex: /adidas/i,                marca: 'Adidas'      },
  { regex: /babolat/i,               marca: 'Babolat'     },
  { regex: /\bnox\b/i,               marca: 'Nox'         },
  { regex: /\bhead\b/i,              marca: 'Head'        },
  { regex: /wilson/i,                marca: 'Wilson'      },
  { regex: /siux/i,                  marca: 'Siux'        },
  { regex: /vibora/i,                marca: 'Vibora'      },
  { regex: /star.?vie/i,             marca: 'Starvie'     },
  { regex: /drop.?shot/i,            marca: 'Drop Shot'   },
  { regex: /royal.?padel/i,          marca: 'Royal Padel' },
  { regex: /kuikma/i,                marca: 'Kuikma'      },
  { regex: /varlion/i,               marca: 'Varlion'     },
  { regex: /black.?crown/i,          marca: 'Black Crown' },
  { regex: /dunlop/i,                marca: 'Dunlop'      },
  { regex: /enebe/i,                 marca: 'Enebe'       },
  { regex: /oxdog/i,                 marca: 'Oxdog'       },
  { regex: /\bpuma\b/i,              marca: 'Puma'        },
  { regex: /akkeron/i,               marca: 'Akkeron'     },
  { regex: /\bjoma\b/i,              marca: 'Joma'        },
  { regex: /kombat/i,                marca: 'Kombat'      },
  { regex: /\blok\b/i,               marca: 'Lok'         },
  { regex: /alkemia/i,               marca: 'Alkemia'     },
  { regex: /softee/i,                marca: 'Softee'      },
  { regex: /kelme/i,                 marca: 'Kelme'       },
  { regex: /vairo/i,                 marca: 'Vairo'       },
  { regex: /teknifibre|tecnifibre/i, marca: 'Tecnifibre'  },
  { regex: /\bmunich\b/i,            marca: 'Munich'      },
  { regex: /ocho.?padel/i,           marca: 'Ocho Padel'  },
]

function detectarMarca(title: string, keyword?: string): string | null {
  for (const { regex, marca } of MARCAS) {
    if (regex.test(title)) return marca
  }
  if (keyword) {
    for (const { regex, marca } of MARCAS) {
      if (regex.test(keyword)) return marca
    }
  }
  return null
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

function wallapopHeaders(): HeadersInit {
  return {
    'Accept':          'application/json, text/plain, */*',
    'Accept-Language': 'es-ES,es;q=0.9',
    'Cache-Control':   'no-cache',
    'DeviceOS':        '0',
    'MPlatform':       'WEB',
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer':         'https://es.wallapop.com/',
    'Origin':          'https://es.wallapop.com',
  }
}

interface WallapopRaw {
  id: string; title: string; price: number; condition: string
  img: string | null; url: string; city: string; date: string; keyword: string
}

async function scrapeKeyword(keyword: string): Promise<{ items: WallapopRaw[], status: number, rawKeys: string[] }> {
  const params = new URLSearchParams({
    keywords: keyword, latitude: '40.4168', longitude: '-3.7038',
    order_by: 'newest', start: '0', step: String(MAX_RESULTS_PER_KEYWORD),
  })
  try {
    const res = await fetch(`https://api.wallapop.com/api/v3/general/search?${params}`, {
      headers: wallapopHeaders(), cache: 'no-store',
    })

    const status = res.status

    if (!res.ok) {
      const body = await res.text()
      console.error(`❌ HTTP ${status} para "${keyword}" — body: ${body.slice(0, 200)}`)
      return { items: [], status, rawKeys: [] }
    }

    const data = await res.json()
    const rawKeys = Object.keys(data)
    const items: any[] = data?.search_objects ?? data?.items ?? []
    console.log(`✅ "${keyword}": ${items.length} items — claves respuesta: ${rawKeys.join(', ')}`)

    return {
      status,
      rawKeys,
      items: items.map((item: any) => ({
        id: String(item.id ?? ''), title: item.title ?? '',
        price: item.sale_price ?? item.price ?? 0, condition: item.condition ?? '',
        img: item.main_image_url ?? item.images?.[0]?.urls?.medium ?? item.images?.[0]?.urls?.big ?? null,
        url: `https://es.wallapop.com/item/${item.web_slug ?? item.id}`,
        city: item.location?.city ?? '',
        date: item.modification_date ? new Date(item.modification_date * 1000).toISOString() : new Date().toISOString(),
        keyword,
      }))
    }
  } catch (err) {
    console.error(`❌ Error en "${keyword}":`, err)
    return { items: [], status: 0, rawKeys: [] }
  }
}

async function verificarAnuncio(externalId: string): Promise<'activo' | 'vendido' | 'error'> {
  try {
    const res = await fetch(`https://api.wallapop.com/api/v3/items/${externalId}`, {
      headers: wallapopHeaders(), cache: 'no-store',
    })
    if (res.status === 404 || res.status === 410) return 'vendido'
    if (!res.ok) return 'error'
    const data = await res.json()
    const flags = data?.item?.flags ?? data
    if (flags?.sold?.flag || flags?.reserved?.flag || data?.sold?.flag || data?.reserved?.flag) return 'vendido'
    return 'activo'
  } catch { return 'error' }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  console.log(`🏓 HuntPadel — Scraper Wallapop (Vercel) — ${new Date().toISOString()}`)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  const allItems: WallapopRaw[] = []
  const debugInfo: { keyword: string, status: number, items: number, rawKeys: string[] }[] = []

  // Solo probamos la primera keyword para el diagnóstico
  const testKeyword = KEYWORDS[0]
  const { items: testItems, status: testStatus, rawKeys } = await scrapeKeyword(testKeyword)
  debugInfo.push({ keyword: testKeyword, status: testStatus, items: testItems.length, rawKeys })

  // Si la primera keyword falla, devolvemos el debug sin procesar el resto
  if (testStatus !== 200) {
    return NextResponse.json({
      ok: false,
      error: `Wallapop devuelve HTTP ${testStatus}`,
      debug: debugInfo,
      elapsed_ms: Date.now() - startedAt,
    })
  }

  // Si la primera keyword funciona pero devuelve 0 items, también lo reportamos
  if (testItems.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'HTTP 200 pero 0 items — respuesta vacía o estructura inesperada',
      debug: debugInfo,
      elapsed_ms: Date.now() - startedAt,
    })
  }

  // Todo OK — procesamos el resto de keywords
  allItems.push(...testItems)
  for (const keyword of KEYWORDS.slice(1)) {
    const { items } = await scrapeKeyword(keyword)
    allItems.push(...items)
    await sleep(1200)
  }

  console.log(`📊 Total items: ${allItems.length}`)

  const seen = new Set<string>()
  const unique = allItems.filter(item => {
    if (!item.id || seen.has(item.id)) return false
    seen.add(item.id)
    const tl = item.title.toLowerCase()
    return !EXCLUIR_SCRAPER.some(w => tl.includes(w))
  })

  const now = new Date().toISOString()
  const BATCH = 100
  let inserted = 0

  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH).map(item => ({
      external_id: item.id, title: item.title, price: item.price, currency: 'EUR',
      condition: item.condition, img: item.img, url: item.url, city: item.city,
      date: item.date, keyword: item.keyword, platform: 'wallapop',
      marca: detectarMarca(item.title, item.keyword), scraped_at: now, last_seen_at: now,
    }))
    const { error } = await supabase.from('wallapop_cache').upsert(batch, { onConflict: 'external_id', ignoreDuplicates: false })
    if (!error) inserted += batch.length
  }

  const idsEncontrados = new Set(unique.map(i => i.id))
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  const { data: enBD } = await supabase.from('wallapop_cache').select('external_id').eq('platform', 'wallapop').gte('last_seen_at', threeDaysAgo)
  const noVistos = (enBD ?? []).filter(r => !idsEncontrados.has(r.external_id))

  if (noVistos.length > 0) {
    const toDelete: string[] = []
    for (const { external_id } of noVistos) {
      if (await verificarAnuncio(external_id) === 'vendido') toDelete.push(external_id)
      await sleep(200)
    }
    if (toDelete.length > 0) await supabase.from('wallapop_cache').delete().in('external_id', toDelete)
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: stale } = await supabase.from('wallapop_cache').select('external_id').eq('platform', 'wallapop').lt('last_seen_at', oneDayAgo)
  if (stale && stale.length > 0) {
    const toDelete: string[] = []
    for (const { external_id } of stale) {
      if (await verificarAnuncio(external_id) === 'vendido') toDelete.push(external_id)
      await sleep(200)
    }
    if (toDelete.length > 0) await supabase.from('wallapop_cache').delete().in('external_id', toDelete)
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  await supabase.from('wallapop_cache').delete().eq('platform', 'wallapop').lt('last_seen_at', thirtyDaysAgo)
  await supabase.from('search_cache').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`🏁 Completado en ${elapsed}s`)

  return NextResponse.json({ ok: true, items: inserted, elapsed_s: parseFloat(elapsed) })
}
