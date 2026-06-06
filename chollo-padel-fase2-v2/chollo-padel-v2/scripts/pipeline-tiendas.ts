/**
 * scripts/pipeline-tiendas.ts
 * =============================================================================
 * Pipeline de precios de tiendas con nueva estrategia de matching por atributos.
 *
 * Flujo por producto:
 *   1. Buscar texto normalizado en producto_aliases → match directo (cache)
 *   2. Extraer atributos → buscar en palas por (marca, linea, modelo, variante, año)
 *      → match único  → price_snapshot + nuevo alias
 *      → ambiguo      → palas_candidatas para revisión manual (Gestor)
 *      → sin match    → palas_candidatas para revisión manual (Gestor)
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/pipeline-tiendas.ts padelnuestro
 *   npx tsx --env-file=.env.local scripts/pipeline-tiendas.ts padelnuestro --dry-run
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js'
import { extraerAtributos, normalizar } from './extract-atributos'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const TIENDA  = process.argv[2]
const DRY_RUN = process.argv.includes('--dry-run')

if (!TIENDA) {
  console.error('❌ Uso: npx tsx pipeline-tiendas.ts <tienda> [--dry-run]')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

// ─── Helpers BD ──────────────────────────────────────────────────────────────

async function getSourceId(slug: string): Promise<string> {
  const { data, error } = await supabase
    .from('price_sources')
    .select('id')
    .eq('slug', slug)
    .single()
  if (error || !data) throw new Error(`Tienda no encontrada en price_sources: ${slug}`)
  return data.id
}

async function buscarPorAlias(textoNorm: string): Promise<string | null> {
  const { data } = await supabase
    .from('producto_aliases')
    .select('pala_id')
    .eq('texto_normalizado', textoNorm)
    .maybeSingle()
  return data?.pala_id ?? null
}

async function buscarPorAtributos(attrs: ReturnType<typeof extraerAtributos>): Promise<{ id: string }[]> {
  if (!attrs.marca || !attrs.linea) return []

  let q = supabase
    .from('palas')
    .select('id, nombre, marca, linea, modelo, variante, año')
    .eq('marca', attrs.marca)
    .eq('linea', attrs.linea)

  // ilike: case-insensitive exact match (evita fallos por mayúsculas padelnuestro vs padelzoom)
  if (attrs.modelo)  q = q.ilike('modelo', attrs.modelo)
  // Si modelo es null no filtramos — si hay múltiples → ambiguo; si hay 1 → match

  if (attrs.variante) q = q.eq('variante', attrs.variante)
  else                q = q.is('variante', null)

  if (attrs.año)     q = q.eq('año', attrs.año)

  const { data } = await q
  return data ?? []
}

async function insertarSnapshot(palaId: string, sourceId: string, producto: {
  precio: number; precioOriginal?: number; url: string; titulo: string
}) {
  if (DRY_RUN) return
  await supabase.from('price_snapshots').upsert({
    pala_id:          palaId,
    source_id:        sourceId,
    precio:           producto.precio,
    precio_original:  producto.precioOriginal ?? null,
    url_producto:     producto.url,
    match_confidence: 1.0,
    match_method:     'attribute_match',
    disponible:       true,
    scraped_at:       new Date().toISOString(),
  }, { onConflict: 'pala_id,source_id,url_producto' })
}

async function insertarAlias(palaId: string, textoOriginal: string, tienda: string, url?: string) {
  if (DRY_RUN) return
  await supabase.from('producto_aliases').upsert({
    pala_id:           palaId,
    texto_original:    textoOriginal,
    texto_normalizado: normalizar(textoOriginal),
    tienda,
    fuente_url:        url ?? null,
    confianza:         1.0,
  }, { onConflict: 'tienda,texto_normalizado', ignoreDuplicates: true })
}

async function insertarCandidata(producto: {
  titulo: string; precio: number; url: string; tienda: string
}, motivo: 'sin_match' | 'ambiguo', candidatos?: string[]) {
  if (DRY_RUN) return
  await supabase.from('palas_candidatas').upsert({
    titulo:            producto.titulo,
    titulo_normalizado: normalizar(producto.titulo),
    precio_min:        producto.precio,
    precio_max:        producto.precio,
    fuentes:           [producto.tienda],
    urls:              [producto.url],
    estado:            motivo === 'ambiguo' ? 'ambiguo' : 'pendiente',
    candidatos_ids:    candidatos ?? [],
    updated_at:        new Date().toISOString(),
  }, { onConflict: 'titulo_normalizado', ignoreDuplicates: false })
}

// ─── Scraper ─────────────────────────────────────────────────────────────────

async function scrape(tienda: string): Promise<{ title: string; price: number; precio_original?: number; url: string }[]> {
  const scraper = require(`./prices/scrapers/${tienda}.js`)
  return scraper.scrape ? await scraper.scrape() : await scraper()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🏓 HUNTPADEL — Pipeline tiendas: ${TIENDA}`)
  console.log(`📅 ${new Date().toISOString()}`)
  if (DRY_RUN) console.log('🔍 DRY-RUN — no se escribe en BD\n')

  // 1. Obtener source_id de la tienda
  const sourceId = await getSourceId(TIENDA)
  console.log(`✅ Tienda encontrada: ${TIENDA} (id: ${sourceId})`)

  // 2. Scrape
  console.log(`\n📥 Scrapeando ${TIENDA}...`)
  const productos = await scrape(TIENDA)
  console.log(`  → ${productos.length} productos`)

  // 3. Matching
  let porAlias = 0, porAtributos = 0, ambiguos = 0, sinMatch = 0

  // Prefijos que indican que NO es una pala individual
  const EXCLUIR_PREFIJOS = ['pack ', 'pala test ', 'bolso ', 'accesorio ']

  for (const p of productos) {
    const tituloLow = p.title.toLowerCase()
    if (EXCLUIR_PREFIJOS.some(pref => tituloLow.startsWith(pref))) {
      if (DRY_RUN) console.log(`  🚫 [excluido] ${p.title}`)
      continue
    }

    const textoNorm = normalizar(p.title)

    // ── Vía 1: alias (cache) ─────────────────────────────────────────────────
    const palaIdAlias = await buscarPorAlias(textoNorm)
    if (palaIdAlias) {
      if (DRY_RUN) {
        console.log(`  ✅ [alias] ${p.title}`)
      } else {
        await insertarSnapshot(palaIdAlias, sourceId, { precio: p.price, precioOriginal: p.precio_original, url: p.url, titulo: p.title })
      }
      porAlias++
      continue
    }

    // ── Vía 2: extractor de atributos ────────────────────────────────────────
    const attrs = extraerAtributos(p.title)
    const candidatos = await buscarPorAtributos(attrs)

    if (candidatos.length === 1) {
      // Match único → snapshot + alias
      const palaId = candidatos[0].id
      if (DRY_RUN) {
        console.log(`  ✅ [atribs] ${p.title}`)
      } else {
        await insertarSnapshot(palaId, sourceId, { precio: p.price, precioOriginal: p.precio_original, url: p.url, titulo: p.title })
        await insertarAlias(palaId, p.title, TIENDA, p.url)
      }
      porAtributos++
    } else if (candidatos.length > 1) {
      // Ambiguo → Gestor
      if (DRY_RUN) {
        console.log(`  ⚠️  [ambiguo] ${p.title} (${candidatos.length} candidatos)`)
      } else {
        await insertarCandidata({ titulo: p.title, precio: p.price, url: p.url, tienda: TIENDA }, 'ambiguo', candidatos.map(c => c.id))
      }
      ambiguos++
    } else {
      // Sin match → Gestor
      if (DRY_RUN) {
        console.log(`  ❌ [sin match] ${p.title}`)
      }
      await insertarCandidata({ titulo: p.title, precio: p.price, url: p.url, tienda: TIENDA }, 'sin_match')
      sinMatch++
    }
  }

  console.log(`
📊 Resultado:
  ✅ Por alias:     ${porAlias}
  ✅ Por atributos: ${porAtributos}
  ⚠️  Ambiguos:     ${ambiguos}  → Gestor
  ❌ Sin match:     ${sinMatch}  → Gestor
  📦 Total:        ${productos.length}
  `)
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
