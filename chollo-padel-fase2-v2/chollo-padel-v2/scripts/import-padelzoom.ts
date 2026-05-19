/**
 * scripts/import-padelzoom.ts
 * ============================================================
 * Enriquece la tabla `palas` con modelos que Padelful no tiene.
 *
 * Estrategia (3 fases):
 *   1. LISTADO  — reutiliza el scraper FacetWP de padelzoom.js
 *                 para obtener todas las URLs del catálogo (~800 palas)
 *   2. FICHA    — fetch individual por URL para extraer año, marca,
 *                 forma, balance, núcleo, cara, peso, jugadores, etc.
 *   3. UPSERT   — inserta en tabla `palas` (onConflict: slug, ignoreDuplicates: true)
 *                 Solo añade palas con slug nuevo — nunca sobreescribe padelful.
 *
 * Ejecutar:
 *   npx tsx --env-file=.env.local scripts/import-padelzoom.ts
 *   npx tsx --env-file=.env.local scripts/import-padelzoom.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/import-padelzoom.ts --limit 50
 */

import { createClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'
import * as https from 'https'

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const DRY_RUN = process.argv.includes('--dry-run')
const LIMIT   = (() => {
  const i = process.argv.indexOf('--limit')
  return i !== -1 ? parseInt(process.argv[i + 1]) : Infinity
})()

const DELAY_MS    = 1200  // cortesía entre fichas individuales
const BATCH_SIZE  = 50
const FACETWP_URL = 'https://padelzoom.es/wp-json/facetwp/v1/refresh'

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
    }, (res) => {
      // Seguir redirecciones manualmente si hace falta
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} para ${url}`))
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
    req.on('error', reject)
    req.setTimeout(20_000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)) })
  })
}

function postJson(url: string, body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const u = new URL(url)
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type':   'application/json',
        'Accept':         'application/json',
        'Referer':        'https://padelzoom.es/palas/',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (e: any) { reject(new Error('JSON parse error: ' + e.message)) }
      })
    })
    req.on('error', reject)
    req.setTimeout(20_000, () => { req.destroy(); reject(new Error('Timeout POST')) })
    req.write(data)
    req.end()
  })
}

// ─── FASE 1: Listado via FacetWP ─────────────────────────────────────────────

interface ListItem {
  title: string
  url:   string
  price: number
}

function parseFwpTemplate(html: string): ListItem[] {
  const $ = cheerio.load(html)
  const items: ListItem[] = []

  $('div.col-md-pala').each((_, card) => {
    const $link = $(card).children('a').first()
    const url   = $link.attr('href')
    if (!url || url === '#') return

    const $text = $link.find('div.text-title-price')
    const title = $text.find('p').first().text().trim()
    if (!title) return

    const priceRaw = $text.find('span.color-blue').text().trim()
    const price    = parseFloat(priceRaw.replace(',', '.'))

    items.push({ title, url, price: isNaN(price) ? 0 : price })
  })

  return items
}

async function fetchListing(): Promise<ListItem[]> {
  console.log('[listado] Obteniendo catálogo via FacetWP...')

  const first = await postJson(FACETWP_URL, {
    action: 'facetwp_refresh',
    data: {
      facets: {}, frozen_facets: {},
      http_params: { uri: 'palas', url_vars: {} },
      template: 'palas',
      extras: { sort: 'default' },
      soft_refresh: 1, is_bfcache: 0, first_load: 0, paged: 1,
    },
  })

  const totalPages = first?.settings?.pager?.total_pages ?? 1
  const totalRows  = first?.settings?.pager?.total_rows  ?? '?'
  console.log(`[listado] ${totalRows} palas en ${totalPages} páginas`)

  const all: ListItem[] = []
  const seen = new Set<string>()

  for (const item of parseFwpTemplate(first.template ?? '')) {
    if (!seen.has(item.url)) { seen.add(item.url); all.push(item) }
  }

  for (let page = 2; page <= totalPages; page++) {
    await sleep(DELAY_MS)
    try {
      const res = await postJson(FACETWP_URL, {
        action: 'facetwp_refresh',
        data: {
          facets: {}, frozen_facets: {},
          http_params: { uri: 'palas', url_vars: {} },
          template: 'palas',
          extras: { sort: 'default' },
          soft_refresh: 1, is_bfcache: 0, first_load: 0, paged: page,
        },
      })
      const items = parseFwpTemplate(res.template ?? '')
      console.log(`[listado] Página ${page}/${totalPages}: ${items.length} palas`)
      for (const item of items) {
        if (!seen.has(item.url)) { seen.add(item.url); all.push(item) }
      }
      if (items.length === 0) break
    } catch (err: any) {
      console.error(`[listado] Error página ${page}: ${err.message}`)
    }
  }

  console.log(`[listado] ✅ Total: ${all.length} palas`)
  return all
}

// ─── FASE 2: Ficha individual ─────────────────────────────────────────────────

interface PalaData {
  slug:             string
  nombre:           string
  marca:            string | null
  brand_slug:       string | null
  modelo:           string | null
  año:              number | null
  forma:            string | null
  balance:          string | null
  material_cara:    string | null
  material_nucleo:  string | null
  material_marco:   string | null
  peso_min:         number | null
  peso_max:         number | null
  jugadores:        string[]
  imagen_url:       string | null
  precio_pvp:       number | null
  fuente:           string
  padelzoom_url:    string
}

// Normaliza texto de spec: "Fibra de Carbono" → "Fibra de carbono"
function normalizeSpec(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

// Extrae slug de una URL padelzoom:
// https://padelzoom.es/palas/bullpadel-vertex-05-2026-juan-tello/ → bullpadel-vertex-05-2026-juan-tello
function urlToSlug(url: string): string {
  return url.replace(/\/$/, '').split('/').pop() ?? ''
}

// Extrae marca del slug o título
// Orden importante: primero las entradas más largas/específicas para evitar falsos positivos
const MARCAS_CONOCIDAS: Array<[string, string]> = [
  ['bullpadel',    'Bullpadel'],
  ['black-crown',  'Black Crown'],
  ['drop-shot',    'Drop Shot'],
  ['star-vie',     'StarVie'],
  ['nox',          'Nox'],
  ['head',         'Head'],
  ['babolat',      'Babolat'],
  ['adidas',       'Adidas'],
  ['wilson',       'Wilson'],
  ['siux',         'Siux'],
  ['vibora',       'Vibora'],
  ['dunlop',       'Dunlop'],
  ['oxdog',        'Oxdog'],
  ['kuikma',       'Kuikma'],
  ['alkemia',      'Alkemia'],
  ['lok',          'Lok'],
  ['royal-padel',  'Royal Padel'],
  ['puma',         'Puma'],
  ['varlion',      'Varlion'],
  ['joma',         'Joma'],
  ['enebe',        'Enebe'],
  ['kombat',       'Kombat'],
  ['wilson',       'Wilson'],
]

function extractMarca(slug: string, title: string): { marca: string | null, brandSlug: string | null } {
  for (const [key, val] of MARCAS_CONOCIDAS) {
    if (slug.startsWith(key) || title.toLowerCase().startsWith(val.toLowerCase())) {
      return { marca: val, brandSlug: key }
    }
  }
  // Fallback: primera palabra del título
  const first = title.split(' ')[0]
  return { marca: first || null, brandSlug: first?.toLowerCase() || null }
}

// Extrae año del slug o título (2024, 2025, 2026)
function extractAño(slug: string, title: string): number | null {
  const match = (slug + ' ' + title).match(/\b(202[3-9])\b/)
  return match ? parseInt(match[1]) : null
}

// Extrae jugadores del título (los que vienen después de la marca/modelo)
// Ej: "Bullpadel Vertex 05 2026 Juan Tello" → ["Juan Tello"]
const JUGADORES_CONOCIDOS = [
  'Juan Tello', 'Agustín Tapia', 'Ale Galán', 'Pablo Lima', 'Maxi Sánchez',
  'Marta Ortega', 'Bea González', 'Gemma Triay', 'Ari Sánchez', 'Coello',
  'Lebron', 'Di Nenno', 'Stupaczuk', 'Chingotto', 'Navarro',
  'Franco Stupaczuk', 'Sanyo Gutiérrez',
]

function extractJugadores(title: string): string[] {
  return JUGADORES_CONOCIDOS.filter(j => title.toLowerCase().includes(j.toLowerCase()))
}

// Extrae modelo (título sin marca, año y jugadores)
function extractModelo(title: string, marca: string | null, año: number | null, jugadores: string[]): string {
  let m = title
  if (marca) m = m.replace(new RegExp(`^${marca}\\s*`, 'i'), '')
  if (año)   m = m.replace(new RegExp(`\\b${año}\\b`, 'g'), '')
  for (const j of jugadores) m = m.replace(new RegExp(j, 'gi'), '')
  return m.replace(/\s+/g, ' ').trim()
}

// Parsea la ficha HTML de padelzoom
function parseFicha(html: string, listItem: ListItem): PalaData {
  const $ = cheerio.load(html)
  const url  = listItem.url
  const slug = urlToSlug(url)

  // Specs: buscar tabla de especificaciones o lista dl/dt/dd
  const specs: Record<string, string> = {}

  // Patrón 1: tabla con th/td
  $('table tr').each((_, row) => {
    const cells = $(row).find('th, td')
    if (cells.length >= 2) {
      const key = normalizeSpec($(cells[0]).text())
      const val = normalizeSpec($(cells[1]).text())
      if (key && val) specs[key.toLowerCase()] = val
    }
  })

  // Patrón 2: lista dl > dt + dd (WooCommerce attributes)
  $('dl').each((_, dl) => {
    const dts = $(dl).find('dt')
    const dds = $(dl).find('dd')
    dts.each((i, dt) => {
      const key = normalizeSpec($(dt).text()).toLowerCase()
      const val = normalizeSpec($(dds.eq(i)).text())
      if (key && val) specs[key] = val
    })
  })

  // Patrón 3: divs con clase woocommerce-product-attributes-item
  $('.woocommerce-product-attributes-item').each((_, item) => {
    const key = normalizeSpec($(item).find('.woocommerce-product-attributes-item__label').text()).toLowerCase()
    const val = normalizeSpec($(item).find('.woocommerce-product-attributes-item__value').text())
    if (key && val) specs[key] = val
  })

  // También intentar extraer imagen principal
  const imagen_url =
    $('meta[property="og:image"]').attr('content') ||
    $('.woocommerce-product-gallery__image img').first().attr('src') ||
    $('img.wp-post-image').first().attr('src') ||
    null

  // Título: og:title o h1
  const rawTitle =
    $('meta[property="og:title"]').attr('content') ||
    $('h1.product_title, h1.entry-title').first().text().trim() ||
    listItem.title

  const { marca, brandSlug } = extractMarca(slug, rawTitle)
  const año = extractAño(slug, rawTitle)
  const jugadores = extractJugadores(rawTitle)
  const modelo = extractModelo(rawTitle, marca, año, jugadores)

  // Mapeo specs → campos BD
  // Las claves pueden variar; probamos alias comunes
  function spec(...keys: string[]): string | null {
    for (const k of keys) {
      const v = specs[k] || specs[k.toLowerCase()]
      if (v && v !== '-' && v !== '') return v
    }
    return null
  }

  const formaRaw = spec('forma', 'shape', 'tipo')
  const slugAndTitle = (slug + ' ' + rawTitle).toLowerCase()

  // Inferir forma desde specs HTML o, si no hay, desde el slug/título
  // Modelos con forma conocida por marca+modelo
  const formaInferida: string | null = (() => {
    if (formaRaw) {
      if (formaRaw.toLowerCase().includes('redond')) return 'Redonda'
      if (formaRaw.toLowerCase().includes('lagrim')) return 'Lágrima'
      if (formaRaw.toLowerCase().includes('diam'))   return 'Diamante'
      return formaRaw
    }
    // Diamante: modelos de potencia/ataque típicos
    if (/\b(vertex|hack|metalbone|at10|speed-pro|coello-pro|viper|xplo|black-mamba|titan|pegasus|electra-pro|electra-st|siux-electra|fenix-pro|trilogy-pro|ea10|nox-ea|conqueror-attack|explorer-pro-attack|axion-attack|drop-axion|canyon-pro-attack|drop-canyon|furia-attack)\b/.test(slugAndTitle)) return 'Diamante'
    // Redonda: modelos de control/mujer
    if (/\b(radical|extreme|coello-motion|coello-team|coello-vibe|extreme-motion|extreme-team|speed-motion|gravity|flow|pearl|elite-woman|indiga|wonder|ionic|brava|kenta|aquila|titania|metheora|basalto|triton-balance|drax|astrum|raptor|yarara|mamba-xtreme|vk10|ml10|future-control|counter|air-viper|air-veron|equation|nextgen|counter-veron|vertuo|drive|match|rx-series|bp10|flow-light|flow-legend|flow-woman|cross-it-light|cross-it-ctrl|cross-it-team|adidas-cross-it-ctrl|adidas-arrow)\b/.test(slugAndTitle)) return 'Redonda'
    // Lágrima: intermedio
    if (/\b(diablo|valkiria|hybrid|hack-hybrid|vertex-hybrid|neuron|hack-comfort|vertex-comfort|hack-advance|vertex-advance|hack-04-2026|neuron-02|xplo-comfort)\b/.test(slugAndTitle)) return 'Lágrima'
    return null
  })()

  const balanceRaw = spec('balance', 'equilibrio')
  const balance = balanceRaw
    ? (balanceRaw.toLowerCase().includes('alto')  ? 'Alto'
      : balanceRaw.toLowerCase().includes('medio') ? 'Medio'
      : balanceRaw.toLowerCase().includes('bajo')  ? 'Bajo'
      : balanceRaw)
    : null

  // Peso: puede venir como "350-370g" o "360 gr" o dos campos
  const pesoRaw = spec('peso', 'weight', 'peso (gr)', 'peso gr')
  let peso_min: number | null = null
  let peso_max: number | null = null
  if (pesoRaw) {
    const nums = pesoRaw.match(/\d{3}/g)?.map(Number).filter(n => n > 280 && n < 450) ?? []
    if (nums.length >= 2) { peso_min = Math.min(...nums); peso_max = Math.max(...nums) }
    else if (nums.length === 1) { peso_min = nums[0] - 10; peso_max = nums[0] + 10 }
  }

  return {
    slug,
    nombre:          rawTitle,
    marca,
    brand_slug:      brandSlug,
    modelo,
    año,
    forma:           formaInferida,
    balance,
    material_cara:   spec('cara', 'superficie', 'material cara', 'golpeo'),
    material_nucleo: spec('núcleo', 'nucleo', 'core', 'interior', 'alma'),
    material_marco:  spec('marco', 'frame', 'perfil'),
    peso_min,
    peso_max,
    jugadores,
    imagen_url:      imagen_url ?? null,
    precio_pvp:      listItem.price > 0 ? listItem.price : null,
    fuente:          'padelzoom',
    padelzoom_url:   url,
  }
}

async function fetchFicha(listItem: ListItem): Promise<PalaData | null> {
  try {
    const html = await httpGet(listItem.url)
    return parseFicha(html, listItem)
  } catch (err: any) {
    console.error(`[ficha] Error ${listItem.url}: ${err.message}`)
    return null
  }
}

// ─── FASE 3: Upsert ───────────────────────────────────────────────────────────

async function upsertBatch(palas: PalaData[]): Promise<{ ok: number, err: number }> {
  let ok = 0, err = 0

  // Mapear a schema de tabla palas
  const rows = palas.map(p => ({
    slug:             p.slug,
    nombre:           p.nombre,
    marca:            p.marca,
    brand_slug:       p.brand_slug,
    modelo:           p.modelo,
    año:              p.año,
    forma:            p.forma,
    balance:          p.balance,
    material_cara:    p.material_cara,
    material_nucleo:  p.material_nucleo,
    material_marco:   p.material_marco,
    peso_min:         p.peso_min,
    peso_max:         p.peso_max,
    jugadores:        p.jugadores,
    imagen_url:       p.imagen_url,
    precio_pvp:       p.precio_pvp,
    fuente:           p.fuente,
    // padelzoom_url: si quieres guardarla, añade la columna en Supabase:
    // ALTER TABLE palas ADD COLUMN padelzoom_url text;
    // y descomenta la línea siguiente:
    // padelzoom_url: p.padelzoom_url,
  }))

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('palas')
      .upsert(batch, {
        onConflict:        'slug',
        ignoreDuplicates:  true,   // solo insertar slugs nuevos — nunca sobreescribir padelful
      })

    if (error) {
      console.error(`[upsert] Error lote ${i}: ${error.message}`)
      err += batch.length
    } else {
      console.log(`[upsert] ✅ Lote ${i}–${i + batch.length - 1} OK`)
      ok += batch.length
    }
  }

  return { ok, err }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏓 import-padelzoom.ts${DRY_RUN ? ' [DRY RUN]' : ''}\n`)

  // FASE 1: Listado
  const listing = await fetchListing()
  const limited = listing.slice(0, LIMIT === Infinity ? listing.length : LIMIT)
  console.log(`\n[main] Procesando ${limited.length} palas${LIMIT !== Infinity ? ` (límite: ${LIMIT})` : ''}`)

  // Sin pre-filtro: ignoreDuplicates:true en el upsert garantiza que los slugs
  // existentes se ignoran. Así evitamos la query .in() con 800 slugs (falla por URL limit).
  const toProcess = limited
  console.log(`[main] Fetcheando fichas de ${toProcess.length} palas (slugs existentes se ignorarán en upsert)...\n`)

  // FASE 2: Fichas individuales
  const palas: PalaData[] = []
  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i]
    process.stdout.write(`[ficha] ${i + 1}/${toProcess.length} ${item.title.substring(0, 50)}...`)
    const pala = await fetchFicha(item)
    if (pala) {
      palas.push(pala)
      process.stdout.write(` ✓ (${pala.marca} | ${pala.año ?? '?'} | ${pala.forma ?? '?'})\n`)
    } else {
      process.stdout.write(` ✗\n`)
    }
    if (i < toProcess.length - 1) await sleep(DELAY_MS)
  }

  console.log(`\n[main] ${palas.length} fichas extraídas correctamente`)

  // FASE 3: Upsert
  if (DRY_RUN) {
    console.log('\n[DRY RUN] Primeras 5 palas que se insertarían:')
    palas.slice(0, 5).forEach(p =>
      console.log(`  ${p.slug} | ${p.marca} | ${p.año} | ${p.forma} | ${p.material_nucleo}`)
    )
  } else {
    const { ok, err } = await upsertBatch(palas)
    console.log(`\n🎉 Completado: ${ok} OK, ${err} errores`)
  }
}

main().catch(err => {
  console.error('Error fatal:', err.message)
  process.exit(1)
})
