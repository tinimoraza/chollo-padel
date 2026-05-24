/**
 * scripts/scrape-vinted.ts
 * ===========================================
 * Scraper de Vinted usando la API pública.
 * Lo ejecuta GitHub Actions cada hora.
 * Guarda los resultados en Supabase tabla wallapop_cache con platform='vinted'.
 *
 * v2 (2026-05-24):
 *  - Paginación incremental: carga IDs ya en BD antes de scrapear.
 *    Por cada keyword pagina hasta encontrar un ID conocido → para.
 *    Primera ejecución trae todo. Siguientes solo lo nuevo.
 *
 * Ejecutar manualmente:
 *   npx tsx --env-file=.env.local scripts/scrape-vinted.ts
 */

import { createClient } from '@supabase/supabase-js'
import { matchPalaIds } from './match-pala-id'
import { detectarMarca } from './detect-marca'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const KEYWORDS = [
  'pala padel',
  'pala babolat',
  'pala nox',
  'pala head padel',
  'pala wilson',
  'pala bullpadel',
  'pala adidas',
  'pala siux',
  'pala drop shot',
  'pala starvie',
  'pala vibora',
  'pala varlion',
  'pala black crown',
]

// Palabras que indican que el anuncio NO es una pala de pádel
// Se filtran ANTES del upsert para no contaminar la BD
const EXCLUIR_SCRAPER = [
  // Raquetas de tenis
  'raqueta tenis', 'raquetas tenis', 'tenis head', 'tenis wilson',
  'pro staff', 'blade v8', 'blade v9', 'blade v10', 'blade 98', 'blade 100',
  'pure drive', 'pure aero', 'pure strike', 'radical mp', 'ultra 98',
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
  // Coleccionismo / fútbol / otros deportes
  'mundial', 'euro 20', 'champions', 'match worn', 'player version',
  'original históri', 'original histori', 'camp nou',
  // Lotes varios
  'lote ', '+ accesorios', 'y accesorios', 'con accesorios',
]

// Vinted devuelve el ID numérico de condición en item.status_id (o item.status como número).
// Ref: https://www.vinted.es (IDs observados en la API)
// 6 = Nuevo con etiquetas, 1 = Nuevo sin etiquetas, 2 = Muy bueno, 3 = Bueno, 4 = Satisfactorio
const CONDITION_MAP_REVERSE: Record<string, string> = {
  // IDs numéricos (lo que realmente devuelve la API de Vinted)
  '6': 'new',            // Nuevo con etiquetas
  '1': 'as_good_as_new', // Nuevo sin etiquetas
  '2': 'good',           // Muy bueno
  '3': 'good',           // Bueno
  '4': 'fair',           // Satisfactorio
  // Strings en español (fallback por si algún endpoint devuelve el label)
  'Nuevo con etiquetas': 'new',
  'Nuevo sin etiquetas': 'as_good_as_new',
  'Muy bueno':           'good',
  'Bueno':               'good',
  'Satisfactorio':       'fair',
}

const PER_PAGE = 96  // máximo estable que acepta la API de Vinted
const MAX_PAGES = 20 // techo de seguridad: nunca más de 20 páginas por keyword (~1920 items)

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── Token Vinted ────────────────────────────────────────────────────────────

let cachedAuth: { cookie: string; token: string; expiresAt: number } | null = null

async function getVintedToken(): Promise<{ cookie: string; token: string } | null> {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) {
    return { cookie: cachedAuth.cookie, token: cachedAuth.token }
  }
  try {
    const res = await fetch('https://www.vinted.es', {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
    })

    const rawCookies = res.headers.getSetCookie?.() ?? []
    const cookie = rawCookies.map(c => c.split(';')[0]).filter(c => {
      const [, val] = c.split('=')
      return val && val.trim().length > 0
    }).join('; ')

    const tokenEntry = rawCookies
      .map(c => c.split(';')[0])
      .find(c => c.startsWith('access_token_web=') && c.length > 'access_token_web='.length + 5)

    const token = tokenEntry?.split('=').slice(1).join('=')
    if (!token) return null

    cachedAuth = { cookie, token, expiresAt: Date.now() + 5 * 60 * 1000 }
    return { cookie, token }
  } catch (err) {
    console.error('Error obteniendo token de Vinted:', err)
    return null
  }
}

// ── Búsqueda de una página ───────────────────────────────────────────────────

async function scrapeKeywordPage(
  keyword: string,
  auth: { cookie: string; token: string },
  page: number
): Promise<any[]> {
  const params = new URLSearchParams({
    search_text: keyword,
    per_page:    String(PER_PAGE),
    page:        String(page),
    order:       'newest_first',
  })

  try {
    const res = await fetch(`https://www.vinted.es/api/v2/catalog/items?${params}`, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Referer':         'https://www.vinted.es/',
        'Cookie':          auth.cookie,
        'Authorization':   `Bearer ${auth.token}`,
      },
    })

    if (!res.ok) {
      console.error(`  ❌ HTTP ${res.status} para "${keyword}" pág ${page}`)
      return []
    }

    const data = await res.json()
    return data.items ?? []
  } catch (err) {
    console.error(`  ❌ Error en "${keyword}" pág ${page}:`, err)
    return []
  }
}

// ── Búsqueda paginada con parada incremental ─────────────────────────────────
// Pagina hasta que encuentra un ID ya conocido en BD (idsEnBD) o no hay más resultados.

async function scrapeKeyword(
  keyword: string,
  auth: { cookie: string; token: string },
  idsEnBD: Set<string>
): Promise<any[]> {
  // Solo exigimos la marca — ignoramos "pala"/"padel" porque en Vinted los
  // títulos son escuetos ("NOX AT10 2024") y no siempre incluyen esas palabras
  const brandWords = keyword.toLowerCase().split(/\s+/).filter(w => w !== 'pala' && w !== 'padel')

  const result: any[] = []
  let totalPaginas = 0

  for (let page = 1; page <= MAX_PAGES; page++) {
    const rawItems = await scrapeKeywordPage(keyword, auth, page)

    if (rawItems.length === 0) {
      // No hay más resultados
      break
    }

    totalPaginas = page
    let encontradoConocido = false

    for (const item of rawItems) {
      const externalId = `vinted_${item.id}`

      // Si encontramos un ID que ya está en BD, todos los siguientes también lo estarán
      // (orden newest_first) — paramos esta keyword
      if (idsEnBD.has(externalId)) {
        encontradoConocido = true
        break
      }

      const titleLower = (item.title ?? '').toLowerCase()

      // Filtro de marca: si la keyword tiene marca, exigirla en el título
      if (brandWords.length > 0 && !brandWords.every(w => titleLower.includes(w))) {
        continue
      }

      const img = item.photo?.url ?? item.photos?.[0]?.url ?? null
      const ts  = item.photo?.high_resolution?.timestamp
      const date = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString()
      const price = parseFloat(item.price?.amount ?? '0')
      const conditionId = String(item.status_id ?? item.status ?? '')
      const condition = CONDITION_MAP_REVERSE[conditionId] ?? conditionId

      result.push({
        external_id: externalId,
        title:       item.title ?? '',
        price,
        currency:    item.price?.currency_code ?? 'EUR',
        condition,
        img,
        url:         item.url ?? `https://www.vinted.es/items/${item.id}`,
        city:        'Europa',
        date,
        keyword,
        platform:    'vinted',
        marca:       detectarMarca(item.title ?? '', keyword),
      })
    }

    if (encontradoConocido) {
      console.log(`  ✅ "${keyword}": ${result.length} nuevos en ${totalPaginas} pág(s) — parado al encontrar ID conocido`)
      return result
    }

    // Si la página vino incompleta, es la última
    if (rawItems.length < PER_PAGE) break

    // Pausa entre páginas para no martillear la API
    await sleep(800)
  }

  console.log(`  ✅ "${keyword}": ${result.length} nuevos en ${totalPaginas} pág(s)`)
  return result
}

// ── Verificar anuncio Vinted activo ─────────────────────────────────────────

async function isVintedItemActive(externalId: string, auth: { cookie: string; token: string }): Promise<boolean> {
  // external_id es "vinted_12345" — extraemos el ID numérico
  const vintedId = externalId.replace('vinted_', '')
  try {
    const res = await fetch(`https://www.vinted.es/api/v2/items/${vintedId}`, {
      headers: {
        'Accept':        'application/json',
        'Cookie':        auth.cookie,
        'Authorization': `Bearer ${auth.token}`,
      },
    })
    if (res.status === 404) return false
    if (!res.ok) return true // Si falla por otro motivo, lo dejamos
    const data = await res.json()
    return data?.item?.can_be_sold !== false
  } catch {
    return true // Si falla la verificación, dejamos el anuncio
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🏓 HUNTPADEL — Scraper Vinted')
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  console.log('🔑 Obteniendo token de Vinted...')
  const auth = await getVintedToken()
  if (!auth) {
    console.error('💥 No se pudo obtener token. Abortando.')
    process.exit(1)
  }
  console.log('✅ Token obtenido\n')

  // ── Cargar IDs ya en BD ANTES de scrapear ───────────────────────────────
  // Esto permite parar la paginación en cuanto encontramos anuncios conocidos.
  console.log('📋 Cargando IDs de Vinted ya en BD...')
  const { data: bdRows, error: bdError } = await supabase
    .from('wallapop_cache')
    .select('external_id')
    .eq('platform', 'vinted')

  if (bdError) {
    console.error('⚠️  Error cargando IDs de BD:', bdError)
    // No abortamos — en el peor caso scrapeamos todo como si fuera la primera vez
  }

  const idsEnBD = new Set<string>((bdRows ?? []).map(r => r.external_id))
  console.log(`✅ ${idsEnBD.size} IDs de Vinted ya en BD\n`)

  // ── Scraping paginado por keyword ────────────────────────────────────────
  const allItems: any[] = []

  for (const keyword of KEYWORDS) {
    console.log(`🔍 Buscando: "${keyword}"`)
    const items = await scrapeKeyword(keyword, auth, idsEnBD)
    allItems.push(...items)
    await sleep(1500) // pausa entre keywords
  }

  console.log(`\n📊 Total items scrapeados: ${allItems.length}`)

  if (allItems.length === 0) {
    console.log('⚠️  Sin resultados nuevos — BD ya estaba al día.')
    // No abortamos: seguimos con la limpieza de vendidos
  } else {
    // ── Deduplicar y filtrar basura ────────────────────────────────────────
    const seen = new Set<string>()
    const unique = allItems.filter(item => {
      if (!item.external_id || seen.has(item.external_id)) return false
      seen.add(item.external_id)
      const tl = (item.title ?? '').toLowerCase()
      if (EXCLUIR_SCRAPER.some(w => tl.includes(w))) return false
      return true
    })

    const filtrados = allItems.length - unique.length
    console.log(`📊 Items únicos: ${unique.length} (${filtrados} filtrados como no-pádel)`)

    if (unique.length === 0) {
      console.log('⚠️  0 items únicos tras filtrar — abortando upsert para proteger BD.')
    } else {
      // ── Upsert en BD ────────────────────────────────────────────────────
      const now = new Date().toISOString()
      const BATCH = 100
      let inserted = 0

      for (let i = 0; i < unique.length; i += BATCH) {
        const batch = unique.slice(i, i + BATCH).map(item => ({
          ...item,
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

      console.log(`\n✅ Guardados ${inserted} items en Supabase.`)
    }
  }

  // ── Verificación AGRESIVA: anuncios en BD que NO aparecieron en este scrape ──
  // Si Vinted deja de devolverlos, casi siempre es porque están vendidos/retirados.
  const idsEncontrados = new Set<string>(allItems.map(i => i.external_id))
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  const { data: enBD } = await supabase
    .from('wallapop_cache')
    .select('external_id')
    .eq('platform', 'vinted')
    .gte('last_seen_at', threeDaysAgo)

  if (enBD && enBD.length > 0) {
    const noVistos = enBD.filter(r => !idsEncontrados.has(r.external_id))
    if (noVistos.length > 0) {
      console.log(`\n🔍 Verificación agresiva: ${noVistos.length} anuncios Vinted no vistos en este scrape...`)
      const toDeleteAggressive: string[] = []

      for (const { external_id } of noVistos) {
        const active = await isVintedItemActive(external_id, auth)
        if (!active) toDeleteAggressive.push(external_id)
        await sleep(300) // throttle
      }

      if (toDeleteAggressive.length > 0) {
        const { error: delErr } = await supabase
          .from('wallapop_cache')
          .delete()
          .in('external_id', toDeleteAggressive)
        if (!delErr) console.log(`🗑️  [Agresivo] Eliminados ${toDeleteAggressive.length} anuncios Vinted vendidos/retirados`)
      } else {
        console.log('✅ [Agresivo] Todos los no vistos siguen activos en Vinted')
      }
    }
  }

  // ── Verificar anuncios Vinted que llevan 1+ día sin aparecer ──
  const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
  const { data: stale, error: staleError } = await supabase
    .from('wallapop_cache')
    .select('external_id')
    .eq('platform', 'vinted')
    .lt('last_seen_at', oneDayAgo)

  if (!staleError && stale && stale.length > 0) {
    console.log(`\n🔍 Verificando ${stale.length} anuncios Vinted sin actividad en 24h+...`)
    const toDelete: string[] = []

    for (const item of stale) {
      const active = await isVintedItemActive(item.external_id, auth)
      if (!active) toDelete.push(item.external_id)
      await sleep(300) // throttle
    }

    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from('wallapop_cache')
        .delete()
        .in('external_id', toDelete)
      if (!delErr) console.log(`🗑️  Eliminados ${toDelete.length} anuncios vendidos/eliminados`)
    } else {
      console.log('✅ Todos siguen activos')
    }
  }

  // ── Borrar anuncios Vinted con más de 30 días sin actividad ──
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { error: deleteError } = await supabase
    .from('wallapop_cache')
    .delete()
    .eq('platform', 'vinted')
    .lt('last_seen_at', thirtyDaysAgo)

  if (deleteError) {
    console.error('⚠️  Error borrando registros viejos:', deleteError)
  }

  // ── Match pala_id automático ─────────────────────────────────────────────
  await matchPalaIds(supabase)

  // ── Invalidar search_cache ────────────────────────────────────────────────
  await supabase.from('search_cache').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  console.log('🗑️  search_cache invalidada')

  console.log('🏁 Scraper Vinted completado.\n')
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
