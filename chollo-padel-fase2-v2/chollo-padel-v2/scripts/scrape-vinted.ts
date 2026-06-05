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

  // ── COBERTURA GENERAL ──────────────────────────────────────────────────
  'pala padel',

  // ── BULLPADEL ──────────────────────────────────────────────────────────
  'bullpadel hack',
  'bullpadel vertex',
  'bullpadel neuron',
  'bullpadel cosmos',
  'bullpadel indiga',
  // 'bullpadel flow', // eliminado: "Flow" es también la línea de calzado Bullpadel → trae zapatillas masivamente
  // 'bullpadel spike' eliminado: Spike es línea de zapatillas Bullpadel, no palas
  'bullpadel gold',
  'bullpadel ionic',

  // ── BABOLAT ────────────────────────────────────────────────────────────
  'babolat viper',
  'babolat vertuo',
  'babolat juan lebron',
  'babolat veron',

  // ── ADIDAS ─────────────────────────────────────────────────────────────
  'adidas metalbone',
  'adidas adipower',
  'adidas drive padel',
  'adidas match padel',
  'adidas rx padel',
  'adidas cross padel',
  'adidas arrow padel',

  // ── HEAD ───────────────────────────────────────────────────────────────
  // extreme/speed/radical etc. son también tenis → añadir "padel"
  'head extreme padel',
  'head speed padel',
  'head radical padel',
  'head instinct padel',
  'head gravity padel',
  'head alpha padel',
  'head delta padel',
  'head flash padel',
  'head zephyr',
  'head coello',

  // ── NOX ────────────────────────────────────────────────────────────────
  'nox at10',
  'nox ml10',
  'nox equation',
  'nox tempo',
  'nox x-one',
  'nox joker',
  'nox nerbo',
  'nox ea10',

  // ── SIUX ───────────────────────────────────────────────────────────────
  'siux diablo',
  'siux electra',
  'siux pegasus',
  'siux fenix',
  'siux trilogy',
  'siux valkiria',
  'siux gea',
  'siux spyder',
  'siux astra',
  'siux beat',

  // ── WILSON ─────────────────────────────────────────────────────────────
  'wilson bela',
  'wilson endure',
  'wilson optix',
  'wilson defy',
  'wilson blade padel',
  'wilson carbon padel',

  // ── STARVIE / STAR VIE ─────────────────────────────────────────────────
  'starvie triton',
  'starvie raptor',
  'starvie metheora',
  'starvie drax',
  'starvie kenta',
  'starvie aquila',
  'starvie basalto',
  'starvie exodus',
  'starvie brava',
  'starvie nyra',
  'starvie radar',
  'star vie triton',
  'star vie raptor',

  // ── VIBORA ─────────────────────────────────────────────────────────────
  'vibora yarara',
  'vibora black mamba',
  'vibora titan',
  'vibora king cobra',
  'vibora botero',
  'vibor-a yarara',
  'vibor-a black mamba',

  // ── DROP SHOT ──────────────────────────────────────────────────────────
  'drop shot axion',
  'drop shot explorer',
  'drop shot conqueror',
  'drop shot canyon',
  'drop shot revenge',
  'drop shot furia',
  'drop shot bora',
  'drop shot ioniq',
  'drop shot x-drive',

  // ── BLACK CROWN ────────────────────────────────────────────────────────
  'black crown piton',
  'black crown patron',
  'black crown gladius',
  'black crown rebel',
  'black crown coyote',

  // ── DUNLOP ─────────────────────────────────────────────────────────────
  'dunlop blitz padel',
  'dunlop speed padel',
  'dunlop inferno padel',

  // ── JOMA ───────────────────────────────────────────────────────────────
  'joma tournament',
  'joma slam padel',
  'joma gold padel',
  'joma valkiria padel',
  'joma blast padel',
  'joma hyper padel',

  // ── VARLION ────────────────────────────────────────────────────────────
  'varlion summum',
  'varlion lf padel',
  'varlion avant',

  // ── TECNIFIBRE ─────────────────────────────────────────────────────────
  'tecnifibre wall',
  'tecnifibre curva',
  'tecnifibre bomba',

  // ── OXDOG ──────────────────────────────────────────────────────────────
  'oxdog hyper',
  'oxdog pure',
  'oxdog ultimate',
  'oxdog hive',
  'oxdog avalon',

  // ── ROYAL PADEL ────────────────────────────────────────────────────────
  'royal padel m27',
  'royal padel m29',
  'royal padel control',

  // ── ENEBE ──────────────────────────────────────────────────────────────
  'enebe space',
  'enebe mustang',
  'enebe spitfire',
  'enebe response',

  // ── KUIKMA ─────────────────────────────────────────────────────────────
  'kuikma padel',

  // ── PUMA PADEL ─────────────────────────────────────────────────────────
  'puma novablitz',
  'puma solarblaze',

  // ── AKKERON ────────────────────────────────────────────────────────────
  'akkeron padel',

  // ── VAIRO ──────────────────────────────────────────────────────────────
  'vairo padel',

  // ── LOK ────────────────────────────────────────────────────────────────
  'lok be padel',
  'lok maxx padel',

  // ── KOMBAT ─────────────────────────────────────────────────────────────
  'kombat padel',

  // ── MARCAS NICHO (solo las que tienen catálogo y precio referencia) ──────
  'alkemia padel',
  'racket project padel',
  'rs padel',

  // Excluidas por 0% match y sin catálogo:
  // munich, slazenger, prince, volt, kaitt, cork, sane, cartri, nzn, vision, endless, tactical, pallap, hirostar

]

// Palabras que indican que el anuncio NO es una pala de pádel
// Se filtran ANTES del upsert para no contaminar la BD
const EXCLUIR_SCRAPER = [
  // Títulos genéricos sin modelo (imposibles de matchear)
  // Vinted europeo devuelve muchos "Racchetta padel", "Raquette de padel" sin info de modelo
  // Solo excluimos si el título ES exactamente esa frase (títulos muy cortos/genéricos)

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
  '3 raquetes', 'lot 3', 'lote 3',
  // Frontenis / otros derivados
  'frontenis', 'raquetero', 'porta raqueta',
  // Beach tennis (se cuela mucho en Vinted)
  'beach tennis',
  // Ropa de pádel (marcas que también hacen ropa)
  'falda ', 'skort', 'longsleeve', 'salopette', 'saia ',
  'vestido', 'conjunto pádel', 'conjunto padel',
  // Ropa y calzado
  'camiseta', 'camisetas', ' talla ', 'talla s', 'talla m', 'talla l', 'talla xl',
  'talla xs', 'zapatilla', 'zapatillas', 'botas ', 'botines', 'calcetines',
  'pantalon', 'pantalón', 'chaqueta', 'sudadera', 'equipacion', 'equipación',
  'chandal', 'chándal', 'shorts', 'polo ',
  // Zapatillas (bambas/basket en varios idiomas)
  'bambas ', 'zapatilla', 'zapatillas', 'schoenen', 'padelschoen', 'scarpe padel',
  'basket padel', 'basket bullpadel', 'basket joma', 'basket munich',
  'chaussure padel', 'chaussures padel', 'scarpe', 'sneaker', 'shoes',
  // Portugués — zapatillas (Vinted PT trae mucho calzado de pádel)
  'sapatilha', 'sapatilhas', 'ténis ', 'tenis ',
  // Pelotas y accesorios
  'pelotas', 'pelota ', 'bolas ', ' bolas', 'balón', 'balon ',
  'tubes padel', 'balles padel', 'botes padel', 'padel balls',
  'mochila', 'paletero', 'bolsa ', ' bolsa', 'grip ', 'overgrip',
  'protector', 'muñequera', 'munequera', 'presurizador',
  'bracciale', 'pulsera', 'zaino ', 'beauty case',
  // Lotes con otros artículos
  '+ ballen', '+ balls', 'racchette da padel –', '2x racchette', '2x palas',
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

// Filtro positivo: al menos una de estas palabras debe estar en el título.
// Evita ropa, zapatillas, raquetas de tenis y otros items que pasan el catalog[]=4597.
const PALABRAS_PALA = [
  'pala', 'padel', 'pádel', 'racchetta padel', 'raquette padel',
  'racket padel', 'raqueta padel', 'raqueta de padel', 'raqueta de pádel',
]

const PER_PAGE            = 96  // máximo estable que acepta la API de Vinted
const MAX_PAGES_PER_KW    = 10  // Vinted corta en ~pág 10-11 con HTTP 400
const GAP_CATCHUP_MIN     = 30  // minutos sin scraping → no limitamos páginas por fecha

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

// ── Cabeceras comunes para la API de Vinted ──────────────────────────────────
function vintedHeaders(auth: { cookie: string; token: string }) {
  return {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':          'application/json, text/plain, */*',
    'Accept-Language': 'es-ES,es;q=0.9',
    'Referer':         'https://www.vinted.es/',
    'Cookie':          auth.cookie,
    'Authorization':   `Bearer ${auth.token}`,
  }
}

// ── Convertir item crudo de Vinted a fila de BD ───────────────────────────────
function mapItem(item: any, keyword: string): object {
  const img         = item.photo?.url ?? item.photos?.[0]?.url ?? null
  const ts          = item.photo?.high_resolution?.timestamp
  const date        = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString()
  const price       = parseFloat(item.price?.amount ?? '0')
  const conditionId = String(item.status_id ?? item.status ?? '')
  const condition   = CONDITION_MAP_REVERSE[conditionId] ?? conditionId

  return {
    external_id: `vinted_${item.id}`,
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
    marca:       detectarMarca(item.title ?? '', ''),
  }
}

// ── Scrape de un keyword: pagina newest_first y para al encontrar ID conocido ─
// Equivalente al scrapeKeyword() de la extensión de Wallapop.
async function scrapeKeyword(
  keyword: string,
  auth: { cookie: string; token: string },
  idsEnBD: Set<string>,
): Promise<any[]> {
  const result: any[] = []

  for (let page = 1; page <= MAX_PAGES_PER_KW; page++) {
    const params = new URLSearchParams({
      search_text: keyword,
      per_page:    String(PER_PAGE),
      page:        String(page),
      order:       'newest_first',
    })
    const url = `https://www.vinted.es/api/v2/catalog/items?${params}&catalog[]=4597`

    let rawItems: any[] = []
    try {
      const res = await fetch(url, { headers: vintedHeaders(auth) })
      if (!res.ok) {
        // 400/429 = límite de paginación de Vinted → fin de resultados, no error
        if (res.status === 400 || res.status === 429) break
        console.error(`  ❌ "${keyword}" pág ${page}: HTTP ${res.status}`)
        break
      }
      const data = await res.json()
      rawItems = data.items ?? []
    } catch (err) {
      console.error(`  ❌ "${keyword}" pág ${page}:`, err)
      break
    }

    if (rawItems.length === 0) break

    // Debug: loguear campos de categoría del primer item de la primera página
    if (page === 1 && result.length === 0 && rawItems.length > 0) {
      const fi = rawItems[0]
      console.log(`  [debug] catalog fields en item:`, {
        catalog_id:   fi.catalog_id,
        catalog:      fi.catalog,
        category_id:  fi.category_id,
        catalog_ids:  fi.catalog_ids,
      })
    }

    let foundKnown = false
    for (const item of rawItems) {
      const externalId = `vinted_${item.id}`
      if (idsEnBD.has(externalId)) { foundKnown = true; break }

      // ── Filtro de categoría: solo aceptar items en catalog 4597 (Palas de pádel) ──
      // Aunque la búsqueda use catalog[]=4597, Vinted devuelve items de otras
      // categorías si el keyword coincide. Verificamos el catalog_id del item.
      const itemCatalogId = item.catalog_id ?? item.catalog?.[0]?.id ?? item.catalog?.[0]
      if (itemCatalogId !== undefined && itemCatalogId !== null && Number(itemCatalogId) !== 4597) continue

      const tl = (item.title ?? '').toLowerCase()

      // Filtro negativo (ropa, calzado, accesorios, otros deportes)
      if (EXCLUIR_SCRAPER.some(w => tl.includes(w))) continue
      if (parseFloat(item.price?.amount ?? '0') < 15) continue

      // Filtro positivo: título debe mencionar pala/padel
      if (!PALABRAS_PALA.some(w => tl.includes(w))) continue

      // Filtro de calidad: títulos con < 4 palabras son genéricos sin modelo
      const wordCount = tl.trim().split(/\s+/).filter(w => w.length > 0).length
      if (wordCount < 4) continue

      result.push(mapItem(item, keyword))
    }

    if (foundKnown) {
      console.log(`  ✅ "${keyword}": parado en pág ${page} (ID conocido) — ${result.length} nuevos`)
      break
    }
    if (rawItems.length < PER_PAGE) {
      console.log(`  ✅ "${keyword}": fin en pág ${page} — ${result.length} nuevos`)
      break
    }

    await sleep(500)
  }

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

  // ── Invalidar search_cache ────────────────────────────────────────────────
  await supabase.from('search_cache').delete().neq('cache_key', '')
  console.log('🗑️  search_cache invalidada')

  console.log('🔑 Obteniendo token de Vinted...')
  const auth = await getVintedToken()
  if (!auth) { console.error('💥 No se pudo obtener token. Abortando.'); process.exit(1) }
  console.log('✅ Token obtenido\n')

  // ── Cargar IDs ya en BD para parada incremental ───────────────────────────
  const { data: existingRows } = await supabase
    .from('wallapop_cache')
    .select('external_id')
    .eq('platform', 'vinted')
    .limit(100000)
  const idsEnBD = new Set<string>((existingRows ?? []).map((r: any) => r.external_id))
  console.log(`📦 IDs en BD: ${idsEnBD.size}`)

  // ── Detectar gap para loguear modo ───────────────────────────────────────
  const { data: lastRow } = await supabase
    .from('wallapop_cache')
    .select('scraped_at')
    .eq('platform', 'vinted')
    .order('scraped_at', { ascending: false })
    .limit(1)
    .single()
  const lastScrapedAt  = lastRow?.scraped_at ? new Date(lastRow.scraped_at) : null
  const minutesSince   = lastScrapedAt ? (Date.now() - lastScrapedAt.getTime()) / 60000 : 9999
  const modeLabel      = minutesSince > GAP_CATCHUP_MIN ? `⚡ Catch-up (${Math.round(minutesSince)} min)` : '✔ Normal (incremental)'
  console.log(`🕐 Modo: ${modeLabel}\n`)

  // ── Scraping por keywords ─────────────────────────────────────────────────
  console.log(`🔍 Scrapeando ${KEYWORDS.length} keywords...\n`)
  const allItems: any[] = []

  for (const keyword of KEYWORDS) {
    try {
      const items = await scrapeKeyword(keyword, auth, idsEnBD)
      if (items.length > 0) {
        allItems.push(...items)
        // Añadir al Set para que keywords siguientes no reprocesen los mismos
        items.forEach(i => idsEnBD.add(i.external_id))
      }
      await sleep(400)
    } catch (err) {
      console.error(`  ❌ Error en "${keyword}":`, err)
    }
  }

  console.log(`\n📊 Total nuevos: ${allItems.length}`)

  if (allItems.length > 0) {
    // Deduplicar (un item puede aparecer en varios keywords)
    const seen = new Set<string>()
    const unique = allItems.filter(item => {
      if (!item.external_id || seen.has(item.external_id)) return false
      seen.add(item.external_id)
      return true
    })
    console.log(`📊 Tras dedup: ${unique.length}`)

    const now = new Date().toISOString()
    const BATCH = 100
    let upserted = 0
    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH).map(item => ({ ...item, scraped_at: now, last_seen_at: now }))
      const { error } = await supabase.from('wallapop_cache').upsert(batch, { onConflict: 'external_id', ignoreDuplicates: false })
      if (error) console.error(`❌ Error upsert batch ${i / BATCH + 1}:`, error)
      else upserted += batch.length
    }
    console.log(`✅ ${upserted} items guardados/actualizados en BD.`)
  }

  // ── TTL: borrar items no vistos en las últimas 48h ───────────────────────
  // Si un item no aparece en 2 scrapes consecutivos (~2h) probablemente está
  // vendido o retirado. Con 48h de margen cubrimos posibles caídas temporales.
  const ttlAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const { error: ttlError, count } = await supabase
    .from('wallapop_cache')
    .delete({ count: 'exact' })
    .eq('platform', 'vinted')
    .lt('last_seen_at', ttlAgo)

  if (!ttlError) console.log(`🗑️  TTL: eliminados ${count ?? 0} items no vistos en 48h`)

  // ── Match pala_id automático ─────────────────────────────────────────────
  await matchPalaIds(supabase)

  console.log('🏁 Scraper Vinted completado.\n')
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
