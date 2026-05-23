/**
 * app/api/cron/scrape-wallapop/route.ts
 * =============================================
 * Scraper de Wallapop ejecutado desde Vercel (sin Playwright).
 * Las peticiones salen con IPs de Vercel → no bloqueadas por Wallapop.
 *
 * Llamado por GitHub Actions con:
 *   curl -X GET "https://huntpadel.com/api/cron/scrape-wallapop" \
 *        -H "Authorization: Bearer $CRON_SECRET"
 *
 * También puede llamarse desde Vercel Cron si se añade a vercel.json.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ── Constantes ────────────────────────────────────────────────────────────────

const MAX_RESULTS_PER_KEYWORD = 40

const KEYWORDS = [
  'pala padel',
  'pala babolat',
  'pala nox',
  'pala head padel',
  'pala wilson padel',
  'pala bullpadel',
  'pala adidas padel',
  'pala siux',
  'pala drop shot',
  'pala starvie',
  'pala vibora padel',
  'pala dunlop padel',
]

const EXCLUIR_SCRAPER = [
  'raqueta tenis', 'raquetas tenis', 'tenis head', 'tenis wilson',
  'pro staff', 'blade v8', 'blade v9', 'blade v10', 'blade 98', 'blade 100',
  'pure drive', 'pure aero', 'pure strike', 'radical mp', 'ultra 98',
  'hierros', 'driver golf', 'speedback', 'putter', 'madera golf',
  'bolas de golf', 'bolas golf', ' golf ',
  'pickleball',
  'blade pro v',
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// Cabeceras que imitan un navegador real. Clave para evitar el 403.
function wallapopHeaders(): HeadersInit {
  return {
    'Accept':          'application/json, text/plain, */*',
    'Accept-Language': 'es-ES,es;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control':   'no-cache',
    'DeviceOS':        '0',
    'MPlatform':       'WEB',
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer':         'https://es.wallapop.com/',
    'Origin':          'https://es.wallapop.com',
  }
}

// ── Scrape de una keyword ─────────────────────────────────────────────────────

interface WallapopRaw {
  id: string
  title: string
  price: number
  condition: string
  img: string | null
  url: string
  city: string
  date: string
  keyword: string
}

async function scrapeKeyword(keyword: string): Promise<WallapopRaw[]> {
  const params = new URLSearchParams({
    keywords:  keyword,
    latitude:  '40.4168',
    longitude: '-3.7038',
    order_by:  'newest',
    start:     '0',
    step:      String(MAX_RESULTS_PER_KEYWORD),
  })

  const url = `https://api.wallapop.com/api/v3/general/search?${params}`

  try {
    const res = await fetch(url, {
      headers: wallapopHeaders(),
      // next: { revalidate: 0 } — no cache en Vercel
      cache: 'no-store',
    })

    if (!res.ok) {
      console.error(`  ❌ HTTP ${res.status} para "${keyword}"`)
      return []
    }

    const data = await res.json()
    const items: any[] = data?.search_objects ?? data?.items ?? []

    console.log(`  ✅ "${keyword}": ${items.length} items`)

    return items.map((item: any) => ({
      id:        String(item.id ?? ''),
      title:     item.title ?? '',
      price:     item.sale_price ?? item.price ?? 0,
      condition: item.condition ?? '',
      img:       item.main_image_url
                 ?? item.images?.[0]?.urls?.medium
                 ?? item.images?.[0]?.urls?.big
                 ?? item.images?.[0]?.medium
                 ?? null,
      url:       `https://es.wallapop.com/item/${item.web_slug ?? item.id}`,
      city:      item.location?.city ?? '',
      date:      item.modification_date
                 ? new Date(item.modification_date * 1000).toISOString()
                 : new Date().toISOString(),
      keyword,
    }))
  } catch (err) {
    console.error(`  ❌ Error en "${keyword}":`, err)
    return []
  }
}

// ── Verificar si un anuncio sigue activo en la API de Wallapop ────────────────

async function verificarAnuncio(externalId: string): Promise<'activo' | 'vendido' | 'error'> {
  try {
    const res = await fetch(
      `https://api.wallapop.com/api/v3/items/${externalId}`,
      { headers: wallapopHeaders(), cache: 'no-store' }
    )
    if (res.status === 404 || res.status === 410) return 'vendido'
    if (!res.ok) return 'error'
    const data = await res.json()
    const flags = data?.item?.flags ?? data
    if (flags?.sold?.flag || flags?.reserved?.flag || data?.sold?.flag || data?.reserved?.flag) {
      return 'vendido'
    }
    return 'activo'
  } catch {
    return 'error'
  }
}

// ── Handler principal ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Seguridad: mismo CRON_SECRET que el resto de rutas cron
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  console.log('🏓 HuntPadel — Scraper Wallapop (Vercel)')
  console.log(`📅 ${new Date().toISOString()}`)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  // ── 1. Scrape de todas las keywords ─────────────────────────────────────────
  const allItems: WallapopRaw[] = []

  for (const keyword of KEYWORDS) {
    console.log(`🔍 Buscando: "${keyword}"`)
    const items = await scrapeKeyword(keyword)
    allItems.push(...items)
    await sleep(1200) // pequeño throttle entre keywords
  }

  console.log(`\n📊 Total items scrapeados: ${allItems.length}`)

  if (allItems.length === 0) {
    console.log('⚠️  Sin resultados — Wallapop sigue bloqueando o sin anuncios.')
    return NextResponse.json({
      ok: false,
      error: 'Sin resultados',
      elapsed_ms: Date.now() - startedAt,
    }, { status: 200 }) // 200 para que GH Actions no marque el job como error
  }

  // ── 2. Deduplicar y filtrar basura ───────────────────────────────────────────
  const seen = new Set<string>()
  const unique = allItems.filter(item => {
    if (!item.id || seen.has(item.id)) return false
    seen.add(item.id)
    const tl = item.title.toLowerCase()
    return !EXCLUIR_SCRAPER.some(w => tl.includes(w))
  })

  console.log(`📊 Items únicos válidos: ${unique.length}`)

  // ── 3. Upsert en Supabase ────────────────────────────────────────────────────
  const now = new Date().toISOString()
  const BATCH = 100
  let inserted = 0

  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH).map(item => ({
      external_id:  item.id,
      title:        item.title,
      price:        item.price,
      currency:     'EUR',
      condition:    item.condition,
      img:          item.img,
      url:          item.url,
      city:         item.city,
      date:         item.date,
      keyword:      item.keyword,
      platform:     'wallapop',
      marca:        detectarMarca(item.title, item.keyword),
      scraped_at:   now,
      last_seen_at: now,
    }))

    const { error } = await supabase
      .from('wallapop_cache')
      .upsert(batch, { onConflict: 'external_id', ignoreDuplicates: false })

    if (error) {
      console.error(`❌ Error en upsert batch ${Math.floor(i / BATCH) + 1}:`, error)
    } else {
      inserted += batch.length
    }
  }

  console.log(`✅ Guardados ${inserted} items en Supabase`)

  // ── 4. Verificación agresiva: anuncios recientes no vistos en este scrape ────
  const idsEncontrados = new Set(unique.map(i => i.id))
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  const { data: enBD } = await supabase
    .from('wallapop_cache')
    .select('external_id')
    .eq('platform', 'wallapop')
    .gte('last_seen_at', threeDaysAgo)

  const noVistos = (enBD ?? []).filter(r => !idsEncontrados.has(r.external_id))

  if (noVistos.length > 0) {
    console.log(`\n🔍 Verificación agresiva: ${noVistos.length} anuncios no vistos...`)
    const toDelete: string[] = []

    for (const { external_id } of noVistos) {
      const estado = await verificarAnuncio(external_id)
      if (estado === 'vendido') toDelete.push(external_id)
      await sleep(200)
    }

    if (toDelete.length > 0) {
      const { error } = await supabase
        .from('wallapop_cache')
        .delete()
        .in('external_id', toDelete)
      if (!error) console.log(`🗑️  [Agresivo] Eliminados ${toDelete.length} anuncios vendidos`)
    } else {
      console.log('✅ [Agresivo] Todos los no vistos siguen activos')
    }
  }

  // ── 5. Verificar anuncios con 1+ día sin aparecer ────────────────────────────
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: stale } = await supabase
    .from('wallapop_cache')
    .select('external_id')
    .eq('platform', 'wallapop')
    .lt('last_seen_at', oneDayAgo)

  if (stale && stale.length > 0) {
    console.log(`\n🔍 Verificando ${stale.length} anuncios sin actividad 24h+...`)
    const toDelete: string[] = []

    for (const { external_id } of stale) {
      const estado = await verificarAnuncio(external_id)
      if (estado === 'vendido') toDelete.push(external_id)
      await sleep(200)
    }

    if (toDelete.length > 0) {
      await supabase.from('wallapop_cache').delete().in('external_id', toDelete)
      console.log(`🗑️  Eliminados ${toDelete.length} anuncios vendidos/eliminados`)
    }
  }

  // ── 6. Borrar anuncios con 30+ días sin actividad ────────────────────────────
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  await supabase
    .from('wallapop_cache')
    .delete()
    .eq('platform', 'wallapop')
    .lt('last_seen_at', thirtyDaysAgo)

  // ── 7. Invalidar search_cache ─────────────────────────────────────────────────
  await supabase
    .from('search_cache')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')
  console.log('🗑️  search_cache invalidada')

  // ── 8. Llamar al endpoint de match-pala-id ────────────────────────────────────
  // match-pala-id.ts es un script de Node, no se puede importar directamente
  // en el edge/serverless. Se llama al endpoint dedicado si existe, o se omite
  // (el cron de GH Actions de match puede correr aparte con `curl` también).
  // Si tienes /api/cron/match-pala-id, descomenta esto:
  //
  // const matchUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/api/cron/match-pala-id`
  // await fetch(matchUrl, {
  //   headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }
  // })

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`\n🏁 Completado en ${elapsed}s`)

  return NextResponse.json({
    ok:        true,
    items:     inserted,
    elapsed_s: parseFloat(elapsed),
  })
}
