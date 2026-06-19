/**
 * scripts/scrape-wallapop.ts
 * ===========================================
 * Scraper de Wallapop con Playwright (navegador real).
 * Lo ejecuta el GitHub Action cada hora.
 * Guarda los resultados en Supabase tabla wallapop_cache.
 *
 * Ejecutar manualmente:
 *   npx tsx --env-file=.env.local scripts/scrape-wallapop.ts
 */

import { chromium } from 'playwright'
import { detectarMarca } from './detect-marca'
import { createClient } from '@supabase/supabase-js'
// NOTA (2026-06-19): matcher unificado — sustituye a match-pala-id.ts (eliminado).
// CommonJS, se importa con require porque comparte motor con el pipeline de tiendas.
const { matchSecondhandCache } = require('./prices/secondhand-matcher')
const { recalculatePriceReference } = require('./prices/pipeline')

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

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
  'pala kuikma',
  'kombat fuji',
  'kombat galeras',
  'kombat krakatoa',
  'pala kombat padel',
  // Marcas con cobertura insuficiente
  'pala tecnifibre',
  'pala joma padel',
  'pala varlion',
  'pala black crown',
  'pala royal padel',
  'pala oxdog',
]

// Palabras que indican que el anuncio NO es una pala de pádel
// Se filtran ANTES del upsert para no contaminar la BD
const STEP = 40          // items por página (máximo estable de Wallapop)
const MAX_PAGES = 5      // máx 5 páginas por keyword = 200 items

const EXCLUIR_SCRAPER = [
  // Raquetas de tenis
  'raqueta tenis', 'raquetas tenis', 'tenis head', 'tenis wilson',
  'pro staff', 'blade v8', 'blade v9', 'blade v10', 'blade 98', 'blade 100',
  'pure drive', 'pure aero', 'pure strike', 'radical mp', 'ultra 98',
  // v2 (2026-06-19): términos técnicos exclusivos de raquetas de TENIS, verificados
  // contra el catálogo de palas antes de añadirlos (ej. "graphene" se excluyó a
  // propósito de esta lista porque SÍ existe en palas reales como "Head Alpha
  // Graphene 360"). Detectado: "Raqueta Head Radical/Liquidmetal/..." (tenis Head)
  // se colaba porque solo bloqueábamos "tenis head" literal.
  'liquidmetal', 'flexpoint', 'midplus', 'oversize', 'speedport', 'microgel',
  'youtek', 'aeroskin', 'inteligence', 'intelligence', 'agassi',
  // Golf
  'hierros', 'driver golf', 'speedback', 'putter', 'madera golf',
  'bolas de golf', 'bolas golf', ' golf ',  // Wilson golf
  // Pickleball
  'pickleball',
  // Wilson tenis específico
  'blade pro v',
  // Esquí / snow
  'esquís', 'esqui ', 'snowboard', 'ski ',
  // Otros deportes
  'raqueta badminton', 'raqueta squash', 'hockey hierba', 'hockey hielo',
  // Máquinas y equipamiento no-pala
  'máquina padel', 'lanzadora', 'maquina padel',
  // Lotes y conjuntos (precio no comparable)
  'lote palas', 'lote pádel', 'conjunto padel', 'set padel',
  '2 palas', '2 raquetas', '3 palas', '4 palas',
  // Ropa y calzado
  'camiseta', 'camisetas', ' talla ', 'talla s', 'talla m', 'talla l', 'talla xl',
  'talla xs', 'zapatilla', 'zapatillas', 'botas ', 'botines', 'calcetines',
  'pantalon', 'pantalón', 'chaqueta', 'sudadera', 'equipacion', 'equipación',
  'chandal', 'chándal', 'shorts', 'polo ',
  // Pelotas y accesorios
  'pelotas', 'pelota ', 'bolas ', ' bolas', 'balón', 'balon ',
  'mochila', 'paletero', 'bolsa ', ' bolsa', 'grip ', 'overgrip',
  'protector', 'muñequera', 'munequera', 'presurizador',
  // Modelos viejos — nunca serán un chollo
  '2018', '2019', '2020', '2021', '2022', '2023',
  // Coleccionismo / fútbol / otros deportes
  'mundial', 'euro 20', 'champions', 'match worn', 'player version',
  'original históri', 'original histori', 'camp nou',
  // Lotes varios
  'lote ', '+ accesorios', 'y accesorios', 'con accesorios',
]

interface WallapopRaw {
  id: string
  title: string
  price: number
  currency: string
  condition: string
  img: string | null
  url: string
  city: string
  date: string
  keyword: string
}

async function scrapeKeyword(
  page: any,
  keyword: string,
  idsEnBD: Set<string>
): Promise<WallapopRaw[]> {
  const allItems: WallapopRaw[] = []

  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    const params = new URLSearchParams({
      keywords:  keyword,
      latitude:  '40.4168',
      longitude: '-3.7038',
      order_by:  'newest',
      start:     String(pageNum * STEP),
      step:      String(STEP),
    })
    const apiUrl = `https://api.wallapop.com/api/v3/general/search?${params}`

    let result: { ok: boolean; status?: number; items: any[] }
    try {
      result = await page.evaluate(async (url: string) => {
        const res = await fetch(url, {
          headers: {
            'Accept':          'application/json',
            'Accept-Language': 'es-ES,es;q=0.9',
            'DeviceOS':        '0',
            'MPlatform':       'WEB',
          },
        })
        if (!res.ok) return { ok: false, status: res.status, items: [] }
        const data = await res.json()
        return { ok: true, items: data?.search_objects ?? data?.items ?? [] }
      }, apiUrl)
    } catch (err) {
      console.error(`  ❌ Error en "${keyword}" pág ${pageNum}:`, err)
      break
    }

    if (!result.ok) {
      console.error(`  ❌ HTTP ${result.status} para "${keyword}" pág ${pageNum}`)
      break
    }

    if (result.items.length === 0) break

    let foundKnown = false
    for (const item of result.items) {
      const externalId = String(item.id ?? '')
      if (idsEnBD.has(externalId)) { foundKnown = true; break }

      allItems.push({
        id:        externalId,
        title:     item.title ?? '',
        price:     item.sale_price ?? item.price ?? 0,
        currency:  'EUR',
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
      })
    }

    if (foundKnown || result.items.length < STEP) break
  }

  console.log(`  ✅ "${keyword}": ${allItems.length} items nuevos`)
  return allItems
}

async function main() {
  console.log('🏓 CHOLLO PADEL — Scraper Wallapop')
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  console.log('🌐 Iniciando Playwright...')
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  })

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    locale:    'es-ES',
    extraHTTPHeaders: {
      'Accept-Language': 'es-ES,es;q=0.9',
    },
  })

  const page = await context.newPage()

  console.log('📦 Cargando wallapop.es para obtener cookies...')
  await page.goto('https://es.wallapop.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2000)

  // Cargar IDs ya en BD para parada incremental
  const { data: bdRows } = await supabase
    .from('wallapop_cache')
    .select('external_id')
    .eq('platform', 'wallapop')
  const idsEnBD = new Set<string>((bdRows ?? []).map((r: any) => r.external_id))
  console.log(`📋 ${idsEnBD.size} IDs de Wallapop ya en BD\n`)

  const allItems: WallapopRaw[] = []

  for (const keyword of KEYWORDS) {
    console.log(`🔍 Buscando: "${keyword}"`)
    const items = await scrapeKeyword(page, keyword, idsEnBD)
    allItems.push(...items)
    await page.waitForTimeout(1500)
  }

  await browser.close()
  console.log(`\n📊 Total items scrapeados: ${allItems.length}`)

  if (allItems.length === 0) {
    console.log('⚠️  Sin resultados de scrape (probablemente 403 Wallapop). Saltando upsert, continuando limpieza...')
  }

  const seen = new Set<string>()
  const unique = allItems.filter((item) => {
    if (!item.id || seen.has(item.id)) return false
    seen.add(item.id)
    // Filtrar basura antes de guardar en BD (tenis, golf, esquí, lotes...)
    const tl = item.title.toLowerCase()
    if (EXCLUIR_SCRAPER.some(w => tl.includes(w))) return false
    return true
  })

  if (unique.length > 0) {
    const filtrados = allItems.length - seen.size
    console.log(`📊 Items únicos: ${unique.length} (${filtrados} filtrados como no-pádel)`)

    const conImagen = unique.filter(i => i.img !== null).length
    console.log(`🖼️  Items con imagen: ${conImagen} / ${unique.length}`)

    const BATCH = 100
    let inserted = 0
    const now = new Date().toISOString()

    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH).map((item) => ({
        external_id:  item.id,
        title:        item.title,
        price:        item.price,
        currency:     item.currency,
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
        console.error(`❌ Error en upsert batch ${i / BATCH + 1}:`, error)
      } else {
        inserted += batch.length
      }
    }
    console.log(`
✅ Guardados ${inserted} items en Supabase.`)
  }

  // ── Verificación AGRESIVA: anuncios en BD que NO aparecieron en este scrape ──
  // Si Wallapop deja de devolverlos, casi siempre es porque están vendidos/retirados.
  // Se verifica inmediatamente contra la API (solo anuncios vistos en los últimos 3 días
  // para evitar verificar anuncios ya obsoletos que el TTL de 1 día limpiará).
  const idsEncontrados = new Set<string>(unique.map(i => i.id))
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  const { data: enBD } = await supabase
    .from('wallapop_cache')
    .select('external_id')
    .eq('platform', 'wallapop')
    .gte('last_seen_at', threeDaysAgo)

  if (enBD && enBD.length > 0) {
    const noVistos = enBD.filter(r => !idsEncontrados.has(r.external_id))
    if (noVistos.length > 0) {
      console.log(`\n🔍 Verificación agresiva: ${noVistos.length} anuncios no vistos en este scrape...`)
      const toDeleteAggressive: string[] = []

      for (const { external_id } of noVistos) {
        try {
          const res = await fetch(`https://api.wallapop.com/api/v3/items/${external_id}`, {
            headers: { 'Accept': 'application/json', 'MPlatform': 'WEB', 'Accept-Language': 'es-ES' },
          })
          if (res.status === 404 || res.status === 410) {
            toDeleteAggressive.push(external_id)
          } else if (res.ok) {
            const data = await res.json()
            const isSold     = data?.sold?.flag    === true || data?.item?.flags?.sold     === true
            const isReserved = data?.reserved?.flag === true || data?.item?.flags?.reserved === true
            if (isSold) {
              // Vendido → borrar inmediatamente
              toDeleteAggressive.push(external_id)
            }
            // Reservado → 3 días de margen; lo gestiona el bloque stale de más abajo
          }
        } catch {
          // Si falla la verificación, lo dejará el bloque stale
        }
        await new Promise(r => setTimeout(r, 200)) // throttle
      }

      if (toDeleteAggressive.length > 0) {
        const { error: delErr } = await supabase
          .from('wallapop_cache')
          .delete()
          .in('external_id', toDeleteAggressive)
        if (!delErr) console.log(`🗑️  [Agresivo] Eliminados ${toDeleteAggressive.length} anuncios vendidos/retirados`)
      } else {
        console.log('✅ [Agresivo] Todos los no vistos siguen activos en la API')
      }
    }
  }

  // ── Verificar anuncios que llevan 3+ días sin aparecer en scrapes ───────────
  // - Vendidos (404/410/sold flag): ya se borran arriba en noVistos al primer run.
  //   Aquí es el safety net por si alguno se escapó.
  // - Reservados: 3 días de margen. Si llevan 3+ días sin aparecer en búsqueda
  //   y siguen reservados, se borran.
  const threeDaysAgoStale = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  const { data: stale, error: staleError } = await supabase
    .from('wallapop_cache')
    .select('external_id, url')
    .eq('platform', 'wallapop')
    .lt('last_seen_at', threeDaysAgoStale)

  if (!staleError && stale && stale.length > 0) {
    console.log(`\n🔍 Verificando ${stale.length} anuncios sin actividad en 3+ días...`)
    const toDelete: string[] = []

    for (const item of stale) {
      try {
        const res = await fetch(`https://api.wallapop.com/api/v3/items/${item.external_id}`, {
          headers: { 'Accept': 'application/json', 'MPlatform': 'WEB' },
        })
        if (res.status === 404 || res.status === 410) {
          toDelete.push(item.external_id)
        } else if (res.ok) {
          const data = await res.json()
          const isSold     = data?.sold?.flag    === true || data?.item?.flags?.sold     === true
          const isReserved = data?.reserved?.flag === true || data?.item?.flags?.reserved === true
          // Vendido o reservado sin actividad 3+ días → borrar
          if (isSold || isReserved) toDelete.push(item.external_id)
        }
      } catch {
        // Si falla la verificación, dejamos el anuncio — se borrará a los 30 días
      }
      await new Promise(r => setTimeout(r, 200)) // throttle
    }

    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from('wallapop_cache')
        .delete()
        .in('external_id', toDelete)
      if (!delErr) console.log(`🗑️  Eliminados ${toDelete.length} anuncios vendidos/reservados caducados`)
    } else {
      console.log('✅ Todos los anuncios siguen activos o en margen de reserva')
    }
  }

  // ── Borrar anuncios con más de 30 días sin actividad ──
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { error: deleteError } = await supabase
    .from('wallapop_cache')
    .delete()
    .eq('platform', 'wallapop')
    .lt('last_seen_at', thirtyDaysAgo)

  if (deleteError) {
    console.error('⚠️  Error borrando registros viejos:', deleteError)
  }

  // ── Match pala_id automático ─────────────────────────────────────────────
  await matchSecondhandCache(supabase, { recalculatePriceReference })

  // ── Invalidar search_cache ────────────────────────────────────────────────
  // Los anuncios borrados (vendidos) quedan en caché hasta TTL si no se invalida.
  // Borramos toda la caché al final de cada scrape para que la próxima búsqueda
  // lea datos frescos de BD.
  await supabase.from('search_cache').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  console.log('🗑️  search_cache invalidada')

  console.log('🏁 Scraper Wallapop completado.\n')
}

main().catch((err) => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
