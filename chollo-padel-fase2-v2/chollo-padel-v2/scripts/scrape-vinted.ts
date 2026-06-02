/**
 * scripts/scrape-vinted.ts
 * ===========================================
 * Scraper de Vinted usando la API pública.
 * Lo ejecuta GitHub Actions cada hora.
 * Guarda los resultados en Supabase tabla wallapop_cache con platform='vinted'.
 *
 * v4 (2026-06-02):
 *  - REDISEÑO: en vez de iterar por keywords, se pagina la categoría
 *    completa catalog[]=4597 (Palas de pádel) sin search_text.
 *    Así se captura TODO el mercado de segunda mano sin depender de
 *    una lista de keywords que siempre estará incompleta.
 *    El match a palas del catálogo se hace igual con matchPalaIds.
 *  - MAX_PAGES subido a 50 (~4800 items por run) para cubrir toda la categoría.
 *    El sistema incremental (para al encontrar IDs conocidos) evita procesar
 *    items que ya están en BD.
 *
 * v3 (2026-05-24): keywords por marca/modelo
 * v2 (2026-05-24): paginación incremental
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

  // ── BULLPADEL ──────────────────────────────────────────────────────────
  'bullpadel hack',
  'bullpadel vertex',
  'bullpadel count',
  'bullpadel spike',
  'bullpadel flow',
  'bullpadel gold',
  'bullpadel legend',
  'bullpadel indiga',
  'bullpadel cosmos',

  // ── NOX ────────────────────────────────────────────────────────────────
  'nox at10',
  'nox ml10',
  'nox equation',
  'nox tempo',
  'nox x-one',
  'nox joker',
  'nox nerbo',
  'nox luxury',
  'nox pro',

  // ── ADIDAS ─────────────────────────────────────────────────────────────
  'adidas metalbone',
  'adidas adipower',
  'adidas match',
  'adidas drive',
  'adidas rx',
  'adidas carbon',
  'adidas cross',
  'adidas arrow',

  // ── HEAD ───────────────────────────────────────────────────────────────
  'head alpha',
  'head delta',
  'head zephyr',
  'head flash',
  'head speed',
  'head extreme',
  'head prestige',
  'head radical',

  // ── WILSON ─────────────────────────────────────────────────────────────
  'wilson bela',
  'wilson carbon',
  'wilson ultra',
  'wilson blade',

  // ── BABOLAT ────────────────────────────────────────────────────────────
  'babolat viper',
  'babolat technical',
  'babolat air',
  'babolat counter',

  // ── SIUX ───────────────────────────────────────────────────────────────
  'siux diablo',
  'siux electra',
  'siux pegasus',
  'siux titan',

  // ── STAR VIE ───────────────────────────────────────────────────────────
  'star vie triton',
  'star vie raptor',
  'star vie drax',
  'star vie kenta',
  'star vie astrum',
  'star vie metheora',
  'star vie basalto',
  'star vie titania',
  'star vie aquila',
  'star vie brava',
  'star vie exodus',
  'star vie black titan',
  'starvie triton',
  'starvie raptor',
  'starvie drax',
  'starvie kenta',
  'starvie astrum',
  'starvie metheora',
  'starvie basalto',

  // ── VIBORA ─────────────────────────────────────────────────────────────
  'vibora titan',
  'vibora yarara',
  'vibora botero',
  'vibora black mamba',

  // ── OXDOG ──────────────────────────────────────────────────────────────
  'oxdog hyper',
  'oxdog pure',
  'oxdog ultimate',
  'oxdog hive',

  // ── VARLION ────────────────────────────────────────────────────────────
  'varlion summum',
  'varlion lf',
  'varlion avant',

  // ── JOMA ───────────────────────────────────────────────────────────────
  'joma gold pro',
  'joma slam pro',
  'joma tournament',
  'joma valkiria',
  'joma hyper pro',
  'joma blast pro',
  'joma blast pro hrd',
  'joma blast pro sft',
  'joma hyper pro hrd',
  'joma hyper pro soft',
  'joma valkiria pro hrd',
  'joma valkiria pro soft',
  'joma slam pro iconic',
  'joma tournament pro iconic',

  // ── SIUX (ampliado) ────────────────────────────────────────────────────
  'siux fenix',
  'siux trilogy',
  'siux valkiria',
  'siux gea',
  'siux spyder',

  // ── VIBORA (ampliado) ─────────────────────────────────────────────────
  'vibora black mamba',
  'vibora king cobra',
  'vibor-a yarara',

  // ── DROP SHOT (ampliado) ──────────────────────────────────────────────
  'drop shot axion',
  'drop shot conqueror',
  'drop shot canyon',
  'drop shot explorer',

  // ── BLACK CROWN (ampliado) ────────────────────────────────────────────
  'black crown piton',
  'black crown patron',
  'black crown gladius',

  // ── MARCAS MEDIAS ─────────────────────────────────────────────────────
  'pala royal padel',
  'pala dunlop',
  'pala tecnifibre',
  'pala puma padel',
  'pala munich padel',
  'pala akkeron',
  'pala vairo',
  'pala kuikma',
  'pala volt padel',
  'pala alkemia',
  'kombat fuji',
  'kombat galeras',
  'kombat krakatoa',
  'kombat etna',
  'pala kombat',
  'enebe mustang',
  'enebe spitfire',
  'enebe response',
  'pala enebe',
  'lok be',
  'pala padel lok',
  'pala hirostar',
  'racket project padel',
  'slazenger padel',
  'pala cork padel',
  'pala sane padel',
  'pala rs padel',
  'pala cartri padel',
  'pala endless padel',
  'tactical padel',
  'pala pallap',

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
  // Modelos viejos — nunca serán un chollo
  '2018', '2019', '2020', '2021', '2022', '2023',
  // Ropa italiana (Vinted italiano)
  'hoodie', 'trackjacket', 'track jacket', 'trackpant', 'jogger', 'gilet',
  'berretto', 'cappello', 'felpa', 'tuta ', 'gonna', 'canottiera', 'giubbino',
  'reggiseno', 'borsone', 'capispalla', 'completino', 'pantaloncini',
  'taglia xs', 'taglia s', 'taglia m', 'taglia l', 'taglia xl',
  // Ropa francesa
  'veste ', 'chemise', 'legging', 'vêtement', 'sweat ', 'pointure', 'taille ',
  // Moda vintage/streetwear
  'hoodie', 'y2k', 'vintage black', 'vintage white', 'tracksuit', 'windbreaker',
  // Zapatillas concretas (modelos non-padel)
  'anthony edwards', 'hoops 3', 'hoops 2', 'supernova', 'solar drive', 'solar glide',
  'copa pure', 'prophere', 'forum xlg', 'forum low', 'bad bunny', 'ultraboost',
  'nmd_', 'yeezy', 'stan smith', 'gazelle', 'samba ', 'adios pro', 'adizero',
  'air max', 'air force', 'dunk ', 'jordan ', 'react ', 'pegasus',
  // Baloncesto, fútbol
  'basketball', 'baloncesto', 'football boot', 'crampons', 'tacos futbol',
  // Coleccionismo / fútbol / otros deportes
  'mundial', 'euro 20', 'champions', 'match worn', 'player version',
  'original históri', 'original histori', 'camp nou',
  // Lotes varios
  'lote ', '+ accesorios', 'y accesorios', 'con accesorios',
  // Calzado (Vinted europeo trae mucho)
  'samba', 'superstar', 'stan smith', 'forum low', 'forum mid',
  'gazelle', 'campus ', 'ultraboost', 'nmd ', 'zx ', 'yeezy',
  'air max', 'air force', 'dunk ', 'jordan ', 'presto ', 'blazer ',
  'new balance', 'salomon ', 'reebok ', 'puma suede', 'puma basket',
  'asics ', 'mizuno ', 'brooks ', 'hoka ', 'on running',
  // Raquetas de otros deportes
  'yonex', 'ezone', 'vcore', 'astrox', 'nanoflare',
  'babolat pure', 'babolat boost', 'babolat drive', // babolat tenis (no pádel)
  'wilson blade', 'wilson ultra', 'wilson clash', 'wilson burn',
  // Ropa europea (francés/italiano)
  'maillot', 'maglia', 'vêtements', 'chaussure', 'scarpe', 'pantaloni',
  'jersey ', 'shirt ', 't-shirt', 'tshirt', 'ensemble ', 'ensemble col',
  // Italiano — ropa y calzado (Vinted IT trae mucho)
  'felpa', 'tuta ', 'maglietta', 'leggings', 'leggins', 'costume',
  'cappello', 'giacca', 'ciabatte', 'canotta', 'vestito', 'borsa ',
  'scarpa', 'sneakers', 'stivali', 'sandali', 'calzini', 'pantaloncini',
  'completo ', 'gonna ', 'maglione', 'pile ', 'giubbotto', 'piumino',
  // Coleccionismo / lujo / otros
  'gucci', 'oakley', 'ray-ban', 'porsche design',
  // Videojuegos / otros
  'jeux video', 'playstation', 'xbox', 'nintendo',
  // Golf específico
  'série club', 'serie club', 'ping ', 'titleist', 'callaway',
  // Zapatillas Adidas (se cuelan por keyword adidas/joma)
  'adidas campus', 'adidas spezial', 'adidas terrex', 'adidas samba',
  'adidas superstar', 'adidas forum', 'adidas stan smith', 'adidas gazelle',
  'adidas nmd', 'adidas zx', 'adidas yeezy', 'adidas solar',
  'adidas prophere', 'adidas equipment',
  // Zapatillas/ropa Joma
  'joma tennis', 'joma ace', 'joma open court', 'joma running',
  // Tenis (modelos específicos que se cuelan)
  'ae 1', 'ae1 ', 'ae 2', 'ae2 ', 'anthony edwards',
  // Herramientas / electrónica / otros
  'bosch', 'makita', 'dewalt', 'pc gaming', 'ordenador', 'monitor',
  // Equipaciones fútbol/basket
  'kids set', 'home set', 'away set', 'third set',
  // Otros coleccionismo
  'neos grandioso', 'levi\'s', 'levis ',
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

const PER_PAGE = 96   // máximo estable que acepta la API de Vinted
const MAX_PAGES = 50  // 50 págs × 96 items = 4800 items por run (cubre toda la categoría)

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

// ── Scrape de la categoría completa catalog[]=4597 (Palas de pádel) ──────────
// No usa search_text — coge TODO lo que Vinted tiene en esa categoría.
// Para cuando encuentra un ID ya conocido en BD (orden newest_first).

async function scrapeCategory(
  auth: { cookie: string; token: string },
  idsEnBD: Set<string>
): Promise<any[]> {
  const result: any[] = []

  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      per_page: String(PER_PAGE),
      page:     String(page),
      order:    'newest_first',
    })
    const url = `https://www.vinted.es/api/v2/catalog/items?${params}&catalog[]=4597`

    let rawItems: any[] = []
    try {
      const res = await fetch(url, {
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
        console.error(`  ❌ HTTP ${res.status} en página ${page}`)
        break
      }
      const data = await res.json()
      rawItems = data.items ?? []
    } catch (err) {
      console.error(`  ❌ Error en página ${page}:`, err)
      break
    }

    if (rawItems.length === 0) break

    let encontradoConocido = false
    for (const item of rawItems) {
      const externalId = `vinted_${item.id}`
      if (idsEnBD.has(externalId)) {
        encontradoConocido = true
        break
      }

      const img  = item.photo?.url ?? item.photos?.[0]?.url ?? null
      const ts   = item.photo?.high_resolution?.timestamp
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
        keyword:     'categoria:palas-padel',
        platform:    'vinted',
        marca:       detectarMarca(item.title ?? '', ''),
      })
    }

    process.stdout.write(`\r  Página ${page}/${MAX_PAGES} — ${result.length} items nuevos`)

    if (encontradoConocido) {
      console.log(`\n  ✅ Parado en pág ${page} al encontrar ID conocido`)
      break
    }

    if (rawItems.length < PER_PAGE) {
      console.log(`\n  ✅ Categoría completa en ${page} páginas`)
      break
    }

    await sleep(600)
  }

  console.log()
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
    if (res.status === 404 || res.status === 410) return false
    if (!res.ok) return true // Si falla por otro motivo, lo dejamos
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) return false // Página de error HTML → vendido/retirado
    const data = await res.json()
    // item inexistente → no disponible
    if (!data?.item) return false
    const item = data.item
    // can_be_sold=false → vendido
    if (item.can_be_sold === false) return false
    // is_visible=false → eliminado por el vendedor
    if (item.is_visible === false || item.is_visible === 0) return false
    // status numérico: Vinted usa 0=activo, otros valores=vendido/reservado/eliminado
    if (typeof item.status === 'number' && item.status !== 0) return false
    return true
  } catch {
    return true // Si falla la verificación, dejamos el anuncio
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🏓 HUNTPADEL — Scraper Vinted')
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  // ── Invalidar search_cache al INICIO (no al final, por si el job muere por timeout) ──
  const { error: cacheErrorInicio } = await supabase
    .from('search_cache')
    .delete()
    .neq('cache_key', '')
  if (cacheErrorInicio) console.error('⚠️  Error invalidando search_cache:', cacheErrorInicio.message)
  else console.log('🗑️  search_cache invalidada')

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

  // ── Scraping de la categoría completa ────────────────────────────────────
  console.log('🔍 Scrapeando categoría completa: Palas de Pádel (catalog[]=4597)...')
  const allItems = await scrapeCategory(auth, idsEnBD)

  console.log(`📊 Total items nuevos scrapeados: ${allItems.length}`)

  if (allItems.length === 0) {
    console.log('⚠️  Sin resultados nuevos — BD ya estaba al día.')
    // No abortamos: seguimos con la limpieza de vendidos
  } else {
    // ── Deduplicar y filtrar basura ────────────────────────────────────────
    const seen = new Set<string>()
    // Solo filtro negativo (EXCLUIR_SCRAPER) — el catalog[]=4597 sin search_text
    // ya garantiza que todos los items son de la categoría "Palas de pádel".
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
    const noVistos = enBD.filter(r => !idsEncontrados.has(r.external_id)).slice(0, 200)
    if (noVistos.length > 0) {
      console.log(`\n🔍 Verificación agresiva: ${noVistos.length} anuncios Vinted (cap 200)...`)
      const toDeleteAggressive: string[] = []
      const toRefreshAggressive: string[] = []

      for (const { external_id } of noVistos) {
        const active = await isVintedItemActive(external_id, auth)
        if (!active) {
          toDeleteAggressive.push(external_id)
        } else {
          toRefreshAggressive.push(external_id)
        }
        await sleep(300) // throttle
      }

      if (toDeleteAggressive.length > 0) {
        const { error: delErr } = await supabase
          .from('wallapop_cache')
          .delete()
          .in('external_id', toDeleteAggressive)
        if (!delErr) console.log(`🗑️  [Agresivo] Eliminados ${toDeleteAggressive.length} anuncios Vinted vendidos/retirados`)
      }

      if (toRefreshAggressive.length > 0) {
        const now = new Date().toISOString()
        for (let i = 0; i < toRefreshAggressive.length; i += 100) {
          await supabase
            .from('wallapop_cache')
            .update({ last_seen_at: now })
            .in('external_id', toRefreshAggressive.slice(i, i + 100))
        }
        console.log(`♻️  [Agresivo] Refrescados ${toRefreshAggressive.length} anuncios activos`)
      }

      if (toDeleteAggressive.length === 0 && toRefreshAggressive.length === 0) {
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
    .limit(500)

  if (!staleError && stale && stale.length > 0) {
    console.log(`\n🔍 Verificando ${stale.length} anuncios Vinted sin actividad en 24h+...`)
    const toDelete: string[] = []
    const toRefresh: string[] = []

    for (const item of stale) {
      const active = await isVintedItemActive(item.external_id, auth)
      if (!active) {
        toDelete.push(item.external_id)
      } else {
        // Refrescar last_seen_at para sacarlo de la cola — evita reverificar el mismo item en cada run
        toRefresh.push(item.external_id)
      }
      await sleep(300) // throttle
    }

    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from('wallapop_cache')
        .delete()
        .in('external_id', toDelete)
      if (!delErr) console.log(`🗑️  Eliminados ${toDelete.length} anuncios vendidos/eliminados`)
    }

    if (toRefresh.length > 0) {
      const now = new Date().toISOString()
      // Actualizar en batches de 100
      for (let i = 0; i < toRefresh.length; i += 100) {
        await supabase
          .from('wallapop_cache')
          .update({ last_seen_at: now })
          .in('external_id', toRefresh.slice(i, i + 100))
      }
      console.log(`♻️  Refrescados ${toRefresh.length} anuncios activos (last_seen_at actualizado)`)
    }

    if (toDelete.length === 0 && toRefresh.length === 0) {
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

  console.log('🏁 Scraper Vinted completado.\n')
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
