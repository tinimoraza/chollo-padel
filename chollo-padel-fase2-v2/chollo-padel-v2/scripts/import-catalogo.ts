/**
 * scripts/import-catalogo.ts
 * =============================================================================
 * Construye el catálogo canónico de palas desde:
 *   1. PADELZOOM (base) — catálogo más completo en España. Cada pala scrapeada
 *      crea una entrada en `productos` con sus atributos estructurados.
 *   2. PADELFUL  (enriquecimiento) — API con ratings y imágenes de calidad.
 *      Busca cada pala de Padelful en `productos` por atributos.
 *      → Si existe: actualiza ratings + imagen_url + añade alias.
 *      → Si no existe: inserta como nuevo producto (con imagen).
 *
 * Anti-duplicados:
 *   El constraint UNIQUE(marca, linea, modelo, variante, año) en BD impide
 *   duplicados exactos. La búsqueda por atributos antes de insertar desde
 *   Padelful evita duplicados semánticos (mismo producto, nombre distinto).
 *
 * Ejecutar:
 *   npx tsx --env-file=.env.local scripts/import-catalogo.ts
 *   npx tsx --env-file=.env.local scripts/import-catalogo.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/import-catalogo.ts --solo padelzoom
 *   npx tsx --env-file=.env.local scripts/import-catalogo.ts --solo padelful
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
  : null

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
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} → ${url}`))
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

function marcaCanonica(brand: string): string | null {
  return Object.entries(MARCAS).find(
    ([, v]) => v.toLowerCase() === brand?.toLowerCase()
  )?.[1] ?? null
}

async function buscarPalaExistente(attrs: Atributos): Promise<string | null> {
  const q = supabase
    .from('palas')
    .select('id')
    .eq('marca', attrs.marca!)
    .eq('linea', attrs.linea!)

  if (attrs.modelo) q.eq('modelo', attrs.modelo)
  else q.is('modelo', null)

  if (attrs.variante) q.eq('variante', attrs.variante)
  else q.is('variante', null)

  if (attrs.año) q.eq('año', attrs.año)
  else q.is('año', null)

  const { data } = await q.maybeSingle()
  return data?.id ?? null
}

async function insertarPala(row: any): Promise<string | null> {
  if (DRY_RUN) {
    console.log(`  [DRY] ${row.nombre}`)
    return 'dry-id'
  }
  const { data, error } = await supabase
    .from('palas')
    .insert(row)
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return null  // ya existe
    console.error(`  ❌ INSERT error: ${error.message}`)
    return null
  }
  return data?.id ?? null
}

async function enriquecerPala(
  id: string,
  ratings: any,
  imagenUrl: string | null,
  pvp: number | null,
  extras: Record<string, any> = {}
) {
  if (DRY_RUN) return
  const update: any = {}
  if (ratings.global)          update.rating_global        = parseFloat(ratings.global)
  if (ratings.power)           update.rating_potencia      = ratings.power
  if (ratings.control)         update.rating_control       = ratings.control
  if (ratings.rebound)         update.rating_rebote        = ratings.rebound
  if (ratings.maneuverability) update.rating_manejabilidad = ratings.maneuverability
  if (ratings.sweetSpot)       update.rating_punto_dulce   = ratings.sweetSpot
  if (imagenUrl)               update.imagen_url           = imagenUrl
  if (pvp)                     update.precio_pvp           = pvp
  Object.assign(update, extras)
  if (Object.keys(update).length > 0) {
    await supabase.from('palas').update(update).eq('id', id)
  }
}

async function insertAlias(palaId: string, textoOriginal: string, tienda: string, url?: string) {
  if (DRY_RUN || !textoOriginal?.trim()) return
  const norm = normalizar(textoOriginal)
  await supabase.from('producto_aliases').upsert({
    pala_id:           palaId,
    texto_original:    textoOriginal,
    texto_normalizado: norm,
    tienda,
    fuente_url:  url ?? null,
    confianza:   1.0,
  }, { onConflict: 'tienda,texto_normalizado', ignoreDuplicates: true })
}

function limpiarModelo(text: string, brand: string): string {
  return text
    .replace(new RegExp(`^${brand}\\s*`, 'i'), '')
    .replace(/^[\s+\-/|]+|[\s+\-/|]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ─── 1. PADELZOOM (base) ──────────────────────────────────────────────────────

interface PadelzoomProduct { title: string; price: number; url: string }

function fwpRequest(page: number): Promise<any> {
  return postJson('https://padelzoom.es/wp-json/facetwp/v1/refresh', {
    action: 'facetwp_refresh',
    data: {
      facets:        {},
      frozen_facets: {},
      http_params: { uri: 'palas', url_vars: {} },
      template:      'palas',
      extras:        { sort: 'default' },
      soft_refresh:  1,
      is_bfcache:    0,
      first_load:    0,
      paged:         page,
    },
  })
}

function parsePadelzoomTemplate(html: string): PadelzoomProduct[] {
  const $ = cheerio.load(html)
  const products: PadelzoomProduct[] = []
  $('div.col-md-pala').each((_, card) => {
    const $link = $(card).children('a').first()
    const url   = $link.attr('href')
    if (!url || url === '#') return
    const $text = $link.find('div.text-title-price')
    const title = $text.find('p').first().text().trim()
    if (!title) return
    const priceRaw = $text.find('span.color-blue').text().trim()
    const price    = parseFloat(priceRaw.replace(',', '.'))
    if (!price || isNaN(price) || price < 20 || price > 2000) return
    products.push({ title, price, url })
  })
  return products
}

async function importarPadelzoom(): Promise<{ ok: number; skip: number; err: number }> {
  console.log('\n📥 PADELZOOM — construyendo catálogo base...')

  // Página 1: obtener total de páginas
  const first = await fwpRequest(1)
  const totalPages = first?.settings?.pager?.total_pages ?? 1
  const totalRows  = first?.settings?.pager?.total_rows  ?? '?'
  console.log(`  → ${totalRows} palas · ${totalPages} páginas`)

  const allProducts: PadelzoomProduct[] = []
  const seen = new Set<string>()

  const p1 = parsePadelzoomTemplate(first.template ?? '')
  p1.forEach(p => { if (!seen.has(p.url)) { seen.add(p.url); allProducts.push(p) } })

  for (let page = 2; page <= totalPages; page++) {
    await sleep(800)
    try {
      const res = await fwpRequest(page)
      const products = parsePadelzoomTemplate(res.template ?? '')
      console.log(`  [padelzoom] página ${page}/${totalPages}: ${products.length} palas`)
      products.forEach(p => { if (!seen.has(p.url)) { seen.add(p.url); allProducts.push(p) } })
      if (products.length === 0) break
    } catch (e: any) {
      console.error(`  ⚠️  Error página ${page}: ${e.message}`)
    }
  }

  console.log(`  → ${allProducts.length} palas únicas`)

  let ok = 0, skip = 0, err = 0

  for (const p of allProducts) {
    try {
      const atributos = extraerAtributos(p.title)
      if (!atributos.marca || !atributos.linea) {
        if (DRY_RUN) console.warn(`  ⚠️  Sin atributos: "${p.title}"`)
        skip++
        continue
      }

      const canon = nombreCanonico(atributos)
      const slug  = generarSlug(atributos)

      const row = {
        marca:    atributos.marca,
        linea:    atributos.linea,
        modelo:   atributos.modelo ?? null,
        variante: atributos.variante ?? null,
        año:      atributos.año ?? null,
        nombre: canon,
        brand_slug: marca.toLowerCase().replace(/\s+/g, '-'),
        slug,
        // precio_pvp inicial = precio mínimo de mercado que marca padelzoom
        // Cuando ≥2 tiendas matcheen esta pala, se recalcula con la media
        precio_pvp: p.price,
        fuente:     'padelzoom',
        updated_at: new Date().toISOString(),
      }

      const id = await insertarPala(row)
      if (id && id !== 'dry-id') {
        await insertAlias(id, p.title, 'padelzoom', p.url)
      }

      ok++
    } catch (e: any) {
      console.error(`  ❌ "${p.title}": ${e.message}`)
      err++
    }
  }

  return { ok, skip, err }
}

// ─── 2. PADELFUL (enriquecimiento) ───────────────────────────────────────────

interface PadelfulRacket {
  slug: string; title: string; brand: string; brandSlug: string
  model: string; season: number | null; shape: string | null
  balance: string | null; feel: string | null; game: string | null
  genre: string | null; weight: [number, number] | null
  materials: { faces?: string; core?: string; frame?: string } | null
  rating: string | null; ratings: Record<string, number> | null
  pvp: number | null; image: string | null; players: string[] | null
}

async function fetchPadelful(): Promise<PadelfulRacket[]> {
  const BASE = 'https://padelful.com/api/v1/rackets'
  const PAGE = 100; let offset = 0; let all: PadelfulRacket[] = []; let hasMore = true
  while (hasMore) {
    console.log(`  [padelful] offset ${offset}...`)
    const res = await fetch(`${BASE}?locale=es&limit=${PAGE}&offset=${offset}`)
    const json = await res.json()
    all = all.concat(json.data?.rackets ?? [])
    hasMore = json.data?.pagination?.hasMore ?? false
    offset += PAGE
    await sleep(500)
  }
  return all
}

async function importarPadelful(): Promise<{ enriquecidas: number; nuevas: number; skip: number; err: number }> {
  console.log('\n📥 PADELFUL — enriqueciendo con ratings e imágenes...')
  const rackets = await fetchPadelful()
  console.log(`  → ${rackets.length} palas de Padelful`)

  let enriquecidas = 0, nuevas = 0, skip = 0, err = 0

  for (const r of rackets) {
    try {
      const marca = marcaCanonica(r.brand)
      if (!marca) { skip++; continue }

      const modelSinMarca = limpiarModelo(r.model ?? r.title ?? '', r.brand)
      const atributos = extraerAtributos(`${marca} ${modelSinMarca}`)
      atributos.marca = marca
      if (r.season) atributos.año = r.season

      if (!atributos.linea) {
        console.warn(`  ⚠️  Sin línea: "${r.title}" → skip`)
        skip++
        continue
      }

      const imagenUrl = r.image ? `https://padelful.com${r.image}` : null

      if (!DRY_RUN) {
        // Buscar si ya existe por atributos (desde padelzoom)
        const idExistente = await buscarPalaExistente(atributos)

        if (idExistente) {
          // Ya existe desde padelzoom → enriquecer con ratings e imagen
          await enriquecerPala(idExistente, {
            global:          r.rating,
            power:           r.ratings?.power,
            control:         r.ratings?.control,
            rebound:         r.ratings?.rebound,
            maneuverability: r.ratings?.maneuverability,
            sweetSpot:       r.ratings?.sweetSpot,
          }, imagenUrl, null, {  // pvp de padelful NO sobreescribe — precio_pvp lo gestiona padelzoom + tiendas
            // Campos técnicos que padelzoom no tiene
            forma:            r.shape   ?? undefined,
            balance:          r.balance ?? undefined,
            tacto:            r.feel    ?? undefined,
            juego:            r.game    ?? undefined,
            genero:           r.genre   ?? undefined,
            peso_min:         r.weight?.[0] ?? undefined,
            peso_max:         r.weight?.[1] ?? undefined,
            material_cara:    r.materials?.faces ?? undefined,
            material_nucleo:  r.materials?.core  ?? undefined,
            material_marco:   r.materials?.frame ?? undefined,
            jugadores:        r.players?.length ? r.players : undefined,
          })
          await insertAlias(idExistente, r.title, 'padelful', `https://padelful.com/es/palas/${r.slug}`)
          enriquecidas++
        } else {
          // No existe en padelzoom → insertar con todos los datos
          const canon = nombreCanonico(atributos)
          const row = {
            marca:    atributos.marca,
            linea:    atributos.linea,
            modelo:   atributos.modelo ?? null,
            variante: atributos.variante ?? null,
            año:      atributos.año ?? null,
            nombre:   canon,
            brand_slug: atributos.marca!.toLowerCase().replace(/\s+/g, '-'),
            slug: generarSlug(atributos),
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
            imagen_url:          imagenUrl,
            padelful_slug:       r.slug,
            fuente:              'padelful',
            updated_at:          new Date().toISOString(),
          }
          const id = await insertarPala(row)
          if (id) {
            await insertAlias(id, r.title, 'padelful', `https://padelful.com/es/palas/${r.slug}`)
            nuevas++
          }
        }
      } else {
        console.log(`  [DRY] ${nombreCanonico(atributos)} ${imagenUrl ? '🖼️' : ''}`)
      }
    } catch (e: any) {
      console.error(`  ❌ "${r.title}": ${e.message}`)
      err++
    }
  }

  return { enriquecidas, nuevas, skip, err }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🏓 HUNTPADEL — Importación catálogo canónico')
  console.log(`📅 ${new Date().toISOString()}`)
  if (DRY_RUN) console.log('🔍 MODO DRY-RUN — no se escribe en BD\n')

  if (!SOLO || SOLO === 'padelzoom') {
    const r = await importarPadelzoom()
    console.log(`\n  Padelzoom: ✅${r.ok} productos base · ⚠️${r.skip} skip · ❌${r.err} err`)
  }

  if (!SOLO || SOLO === 'padelful') {
    const r = await importarPadelful()
    console.log(`\n  Padelful: 🔄${r.enriquecidas} enriquecidas · ✅${r.nuevas} nuevas · ⚠️${r.skip} skip · ❌${r.err} err`)
  }

  if (!DRY_RUN) {
    const { count: p } = await supabase.from('palas').select('*', { count: 'exact', head: true })
    const { count: a } = await supabase.from('producto_aliases').select('*', { count: 'exact', head: true })
    const { count: sinImg } = await supabase.from('palas').select('*', { count: 'exact', head: true }).is('imagen_url', null)
    console.log(`\n📊 BD: ${p} palas · ${a} aliases · ${sinImg} sin imagen`)
  }
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
