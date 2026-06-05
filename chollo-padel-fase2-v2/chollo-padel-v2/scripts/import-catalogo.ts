/**
 * scripts/import-catalogo.ts
 * =============================================================================
 * Construye el catálogo canónico de palas desde Padelful (API) + Padelzoom (scrape).
 *
 * Estrategia:
 *   1. PADELFUL  — fuente primaria. API propia con datos estructurados
 *                  (marca, model, season, shape, balance, ratings, etc.)
 *                  Cada pala → extracción de atributos → INSERT en `productos`
 *                  → INSERT alias en `producto_aliases`
 *
 *   2. PADELZOOM — fuente complementaria. Rellena palas que Padelful no tiene.
 *                  Scrape FacetWP → ficha individual → extracción de atributos
 *                  → Si la pala YA existe (mismo marca+linea+modelo+variante+año) → solo añade alias
 *                  → Si NO existe → INSERT en `productos`
 *
 * Filosofía:
 *   - Un producto = una fila en `productos`. Nunca duplicar.
 *   - Cada nombre de tienda = un alias en `producto_aliases`.
 *   - La confianza del match posterior depende de la solidez de esta base.
 *
 * Ejecutar:
 *   npx tsx --env-file=.env.local scripts/import-catalogo.ts
 *   npx tsx --env-file=.env.local scripts/import-catalogo.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/import-catalogo.ts --solo padelful
 *   npx tsx --env-file=.env.local scripts/import-catalogo.ts --solo padelzoom
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js'
import * as https from 'https'
import * as cheerio from 'cheerio'
import {
  extraerAtributos, normalizar, nombreCanonico, generarSlug,
  MARCAS, Atributos
} from './extract-atributos'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!
const DRY_RUN = process.argv.includes('--dry-run')
const SOLO    = process.argv.includes('--solo')
  ? process.argv[process.argv.indexOf('--solo') + 1]
  : null  // 'padelful' | 'padelzoom' | null (ambos)

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/json',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} → ${url}`))
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
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'Mozilla/5.0',
        'Origin': 'https://padelzoom.es',
        'Referer': 'https://padelzoom.es/palas/',
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

// ─── BD helpers ───────────────────────────────────────────────────────────────

async function upsertProducto(row: any): Promise<string | null> {
  if (DRY_RUN) {
    console.log(`  [DRY] ${row.nombre_canonico}`)
    return 'dry-run-id'
  }
  // Intentar INSERT; si hay conflicto de unicidad (marca+linea+modelo+variante+año)
  // devolvemos el id existente para añadir el alias igualmente.
  const { data, error } = await supabase
    .from('productos')
    .upsert(row, { onConflict: 'marca,linea,modelo,variante,año', ignoreDuplicates: false })
    .select('id')
    .single()

  if (error) {
    // Conflicto de slug — intentar recuperar el id existente
    const { data: existing } = await supabase
      .from('productos')
      .select('id')
      .eq('marca', row.marca)
      .eq('linea', row.linea)
      .eq('modelo', row.modelo ?? '')
      .eq('variante', row.variante ?? '')
      .eq('año', row.año)
      .maybeSingle()
    return existing?.id ?? null
  }
  return data?.id ?? null
}

async function insertAlias(productoId: string, textoOriginal: string, tienda: string, url?: string) {
  if (DRY_RUN) return
  const norm = normalizar(textoOriginal)
  await supabase.from('producto_aliases').upsert({
    producto_id:      productoId,
    texto_original:   textoOriginal,
    texto_normalizado: norm,
    tienda,
    fuente_url: url ?? null,
    confianza:  1.0,  // fuente oficial → confianza máxima
  }, { onConflict: 'tienda,texto_normalizado', ignoreDuplicates: true })
}

// ─── PADELFUL ─────────────────────────────────────────────────────────────────

interface PadelfulRacket {
  slug: string
  title: string
  brand: string
  brandSlug: string
  model: string
  season: number | null
  shape: string | null
  balance: string | null
  feel: string | null
  game: string | null
  genre: string | null
  weight: [number, number] | null
  materials: { faces?: string; core?: string; frame?: string } | null
  rating: string | null
  ratings: Record<string, number> | null
  pvp: number | null
  image: string | null
  players: string[] | null
}

async function fetchPadelful(): Promise<PadelfulRacket[]> {
  const BASE = 'https://padelful.com/api/v1/rackets'
  const PAGE = 100
  let offset = 0
  let all: PadelfulRacket[] = []
  let hasMore = true

  while (hasMore) {
    const url = `${BASE}?locale=es&limit=${PAGE}&offset=${offset}`
    console.log(`  [padelful] offset ${offset}...`)
    const res = await fetch(url)
    const json = await res.json()
    const rackets = json.data?.rackets ?? []
    all = all.concat(rackets)
    hasMore = json.data?.pagination?.hasMore ?? false
    offset += PAGE
    await sleep(500)
  }
  return all
}

async function importarPadelful(): Promise<{ ok: number; skip: number; err: number }> {
  console.log('\n📥 PADELFUL — importando catálogo...')
  const rackets = await fetchPadelful()
  console.log(`  → ${rackets.length} palas obtenidas`)

  let ok = 0, skip = 0, err = 0

  for (const r of rackets) {
    try {
      // Padelful ya da marca y año estructurados — los usamos directamente.
      // Extraemos línea, modelo y variante del campo `model` (más limpio que title).
      const tituloParaExtraer = `${r.brand} ${r.model ?? r.title}`
      const atributos = extraerAtributos(tituloParaExtraer)

      // Si padelful da marca directa, la usamos (más fiable que la detección)
      const marcaCanonica = Object.entries(MARCAS).find(
        ([, v]) => v.toLowerCase() === r.brand?.toLowerCase()
      )?.[1] ?? atributos.marca ?? r.brand

      if (!marcaCanonica || !atributos.linea) {
        console.warn(`  ⚠️  Sin marca/línea: "${r.title}" → skip`)
        skip++
        continue
      }

      const año = r.season ?? atributos.año
      const attrs: Atributos = {
        marca:    marcaCanonica,
        linea:    atributos.linea,
        modelo:   atributos.modelo,
        variante: atributos.variante,
        año,
      }

      const canon = nombreCanonico(attrs)
      const slug  = generarSlug(attrs)

      const row = {
        marca:    attrs.marca,
        linea:    attrs.linea,
        modelo:   attrs.modelo ?? null,
        variante: attrs.variante ?? null,
        año:      attrs.año ?? null,
        nombre_canonico:     canon,
        slug,
        forma:               r.shape ?? null,
        balance:             r.balance ?? null,
        tacto:               r.feel ?? null,
        juego:               r.game ?? null,
        genero:              r.genre ?? null,
        peso_min:            r.weight?.[0] ?? null,
        peso_max:            r.weight?.[1] ?? null,
        material_cara:       r.materials?.faces ?? null,
        material_nucleo:     r.materials?.core ?? null,
        material_marco:      r.materials?.frame ?? null,
        rating_global:       r.rating ? parseFloat(r.rating) : null,
        rating_potencia:     r.ratings?.power ?? null,
        rating_control:      r.ratings?.control ?? null,
        rating_rebote:       r.ratings?.rebound ?? null,
        rating_manejabilidad: r.ratings?.maneuverability ?? null,
        rating_punto_dulce:  r.ratings?.sweetSpot ?? null,
        precio_pvp:          r.pvp ?? null,
        jugadores:           r.players ?? [],
        imagen_url:          r.image ? `https://padelful.com${r.image}` : null,
        fuente:              'padelful',
        fuente_url:          `https://padelful.com/es/palas/${r.slug}`,
        fuente_id:           r.slug,
        updated_at:          new Date().toISOString(),
      }

      const id = await upsertProducto(row)
      if (id && id !== 'dry-run-id') {
        // Alias con el título original de padelful y con el título completo
        await insertAlias(id, r.title, 'padelful', `https://padelful.com/es/palas/${r.slug}`)
        if (r.model && r.model !== r.title) {
          await insertAlias(id, `${r.brand} ${r.model}`, 'padelful')
        }
      }

      console.log(`  ✅ ${canon}`)
      ok++
    } catch (e: any) {
      console.error(`  ❌ "${r.title}": ${e.message}`)
      err++
    }
  }

  return { ok, skip, err }
}

// ─── PADELZOOM ────────────────────────────────────────────────────────────────

async function fetchPadelzoomUrls(): Promise<string[]> {
  const FACETWP_URL = 'https://padelzoom.es/wp-json/facetwp/v1/refresh'
  const urls: string[] = []
  let page = 1

  while (true) {
    console.log(`  [padelzoom] página ${page}...`)
    const body = {
      action: 'facetwp_refresh',
      data: {
        facets: {},
        template: 'wp_template',
        query_args: { post_type: 'product', posts_per_page: 20 },
        paged: page,
        first_load: page === 1 ? 1 : 0,
        soft_refresh: page > 1 ? 1 : 0,
        is_bots: false,
      },
    }
    const json = await postJson(FACETWP_URL, body)
    const html = json.template ?? ''
    const $ = cheerio.load(html)

    const found: string[] = []
    $('a[href*="padelzoom.es"]').each((_, el) => {
      const href = $(el).attr('href')
      if (href && href.includes('padelzoom.es/palas/') && !href.includes('categoria') && !href.includes('marca')) {
        found.push(href)
      }
    })

    if (found.length === 0) break
    urls.push(...found)

    const totalPages = parseInt(json.pager?.total_pages ?? '1')
    if (page >= totalPages) break
    page++
    await sleep(800)
  }

  return [...new Set(urls)]
}

async function fetchPadelzoomFicha(url: string): Promise<{ title: string; precio?: number } | null> {
  try {
    const html = await httpGet(url)
    const $ = cheerio.load(html)
    const title = $('h1.product_title, h1.entry-title').first().text().trim()
    const precioText = $('.price .woocommerce-Price-amount').last().text().replace(/[^\d,.]/g, '').replace(',', '.')
    const precio = parseFloat(precioText) || undefined
    return title ? { title, precio } : null
  } catch {
    return null
  }
}

async function importarPadelzoom(): Promise<{ ok: number; alias: number; skip: number; err: number }> {
  console.log('\n📥 PADELZOOM — importando catálogo...')
  const urls = await fetchPadelzoomUrls()
  console.log(`  → ${urls.length} URLs encontradas`)

  let ok = 0, alias = 0, skip = 0, err = 0

  for (const url of urls) {
    try {
      const ficha = await fetchPadelzoomFicha(url)
      if (!ficha?.title) { skip++; continue }

      const atributos = extraerAtributos(ficha.title)
      if (!atributos.marca || !atributos.linea) {
        console.warn(`  ⚠️  Sin atributos: "${ficha.title}" → skip`)
        skip++
        continue
      }

      // ¿Ya existe este producto en BD?
      const { data: existente } = await supabase
        .from('productos')
        .select('id')
        .eq('marca', atributos.marca)
        .eq('linea', atributos.linea)
        .is('modelo', atributos.modelo ? undefined : null)
        .eq(atributos.modelo ? 'modelo' : 'id', atributos.modelo ?? 'x')
        .is('variante', atributos.variante ? undefined : null)
        .eq(atributos.variante ? 'variante' : 'id', atributos.variante ?? 'x')
        .eq('año', atributos.año ?? 0)
        .maybeSingle()

      if (existente?.id) {
        // Solo añadir alias nuevo
        await insertAlias(existente.id, ficha.title, 'padelzoom', url)
        console.log(`  ↩️  alias: "${ficha.title}"`)
        alias++
      } else {
        // Insertar nuevo producto
        const canon = nombreCanonico(atributos)
        const slug  = generarSlug(atributos)
        const row = {
          marca:    atributos.marca,
          linea:    atributos.linea,
          modelo:   atributos.modelo ?? null,
          variante: atributos.variante ?? null,
          año:      atributos.año ?? null,
          nombre_canonico: canon,
          slug,
          precio_pvp: ficha.precio ?? null,
          fuente:     'padelzoom',
          fuente_url: url,
          fuente_id:  url.split('/').filter(Boolean).pop() ?? '',
          updated_at: new Date().toISOString(),
        }
        const id = await upsertProducto(row)
        if (id && id !== 'dry-run-id') {
          await insertAlias(id, ficha.title, 'padelzoom', url)
        }
        console.log(`  ✅ ${canon}`)
        ok++
      }

      await sleep(1200)
    } catch (e: any) {
      console.error(`  ❌ ${url}: ${e.message}`)
      err++
    }
  }

  return { ok, alias, skip, err }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🏓 HUNTPADEL — Importación catálogo canónico')
  console.log(`📅 ${new Date().toISOString()}`)
  if (DRY_RUN) console.log('🔍 MODO DRY-RUN — no se escribe en BD\n')

  let totalOk = 0

  if (!SOLO || SOLO === 'padelful') {
    const r = await importarPadelful()
    console.log(`\n  Padelful: ✅${r.ok} ⚠️${r.skip} ❌${r.err}`)
    totalOk += r.ok
  }

  if (!SOLO || SOLO === 'padelzoom') {
    const r = await importarPadelzoom()
    console.log(`\n  Padelzoom: ✅${r.ok} nuevo ↩️${r.alias} alias ⚠️${r.skip} ❌${r.err}`)
    totalOk += r.ok
  }

  // Resumen final en BD
  const { count } = await supabase.from('productos').select('*', { count: 'exact', head: true })
  const { count: aliasCount } = await supabase.from('producto_aliases').select('*', { count: 'exact', head: true })
  console.log(`\n📊 BD: ${count} productos · ${aliasCount} aliases`)
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
