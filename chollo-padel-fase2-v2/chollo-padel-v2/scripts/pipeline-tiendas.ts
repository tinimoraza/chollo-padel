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

// Traduce la variante a una forma común para comparar candidata vs catálogo,
// sin importar si está escrita "CTRL" o "CONTROL" (mismo significado, distinta palabra).
// OJO: esta tabla es una lista cerrada y controlada — solo se añaden pares aquí
// cuando se ha confirmado que significan EXACTAMENTE lo mismo (ver caso Light/Lite,
// que demostró que no todas las abreviaturas son intercambiables).
const VARIANTE_EQUIVALENCIAS: Record<string, string> = {
  'control': 'ctrl', 'ctrl': 'ctrl',
}

function normalizarVariante(v: string | null): string | null {
  if (!v) return null
  const norm = v.toLowerCase().trim()
  return VARIANTE_EQUIVALENCIAS[norm] ?? norm
}

// Tokens que, si aparecen en el catálogo pero no en lo extraído, indican un producto
// distinto (no solo "especificación adicional"). Impide que "3.4" matchee "CTRL 3.4"
// o que "Cross It" matchee "Cross It Team" cuando la tienda no menciona Team.
// Regla: "Genius 12K" ⊆ "Genius 12K Alum" → extra='alum' → no discriminante → OK.
//        "3.4" ⊆ "CTRL 3.4"               → extra='ctrl' → discriminante → NO match.
const MODELO_DISCRIMINANTES = new Set([
  'ctrl', 'control', 'team', 'hybrid', 'air', 'carbon', 'light',
  'plus', 'elite', 'power', 'soft', 'iron', 'speed', 'hard', 'free',
])

// Devuelve true si los tokens del modelo extraído son todos subconjunto del modelo
// del catálogo, o viceversa. Permite matchear "GENIUS 12K" con "Genius 12K Alum":
// la tienda omitió "Alum" pero no contradice el catálogo.
// Si no hay modelo extraído → no filtramos por modelo (cualquier modelo vale).

// Dos tokens son "compatibles" si son iguales o difieren solo en 1 carácter final
// (e.g., "xtrem"/"xtreme"). Solo aplica a tokens >=4 chars.
function tokensCompatibles(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 4 || b.length < 4) return false
  if (Math.abs(a.length - b.length) === 1) return a.startsWith(b) || b.startsWith(a)
  return false
}

function tokenIn(t: string, arr: string[]): boolean {
  return arr.some(x => tokensCompatibles(t, x))
}

function modeloCompatible(modeloCat: string | null, modeloExtraido: string | null): boolean {
  // Si la tienda no especifica modelo → solo matchea palas que tampoco tienen modelo.
  // "CROSS IT CTRL" no debe ir a "Cross It Team CTRL" solo porque Team no se menciona.
  if (!modeloExtraido) return !modeloCat
  if (!modeloCat)      return false
  const tokenizar = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean)
  const tCat = tokenizar(modeloCat)
  const tExt = tokenizar(modeloExtraido)
  // Caso 1: tienda omite palabras (e.g., "GENIUS 12K" subset "Genius 12K Alum")
  // Solo permitido si las palabras extra del catalogo no son discriminantes
  if (tExt.every(t => tokenIn(t, tCat))) {
    const extra = tCat.filter(t => !tokenIn(t, tExt))
    return !extra.some(t => MODELO_DISCRIMINANTES.has(t))
  }
  // Caso 2: tienda añade palabras (catálogo subset tienda)
  if (tCat.every(t => tokenIn(t, tExt))) return true
  return false
}

async function buscarPorAtributos(attrs: ReturnType<typeof extraerAtributos>): Promise<{ id: string }[]> {
  if (!attrs.marca || !attrs.linea) return []

  let q = supabase
    .from('palas')
    .select('id, nombre, marca, linea, modelo, variante, año')
    .eq('marca', attrs.marca)
    .eq('linea', attrs.linea)

  // OJO: NO filtramos modelo en SQL — usamos match por subconjunto de tokens en
  // memoria (ver modeloCompatible). Motivo: algunas tiendas escriben "GENIUS 12K"
  // donde el catálogo tiene "Genius 12K Alum". Un ilike exacto los trataría como
  // productos distintos y crearía una fila duplicada.

  // OJO: NO filtramos por año en la consulta SQL. Si lo hiciéramos con
  // `.eq('año', attrs.año)`, cualquier pala ya existente con año=null quedaría
  // excluida aunque sea el mismo producto (caso real: "Siux Electra Lite ST3" -
  // Padelful trae año=2023, Padelzoom no informa año → se creó una fila duplicada
  // porque el filtro SQL descartó la fila sin año). Filtramos el año en memoria,
  // tratando "sin año" como comodín compatible con cualquier año.

  const { data } = await q
  // Comparamos variante "traducida" en memoria (CTRL == CONTROL, etc.) en vez de
  // comparar el string literal — evita falsos "sin match" por convenciones distintas
  // entre cómo lo escribe la tienda y cómo está guardado en el catálogo.
  const filtrados = (data ?? []).filter(p => {
    const variantesCoinciden = normalizarVariante(p.variante) === normalizarVariante(attrs.variante)
    // Año compatible si coinciden, o si a alguno de los dos lados le falta el dato
    const añoCompatible = !attrs.año || !p.año || p.año === attrs.año
    // Modelo compatible si los tokens del extraído son subconjunto del catálogo o viceversa.
    // Permite que "GENIUS 12K" (tienda) matchee con "Genius 12K Alum" (catálogo).
    const modeloOk = modeloCompatible(p.modelo, attrs.modelo)
    return variantesCoinciden && añoCompatible && modeloOk
  })

  // "Sin año" auto-resolución:
  // Si el título no lleva año y hay varios candidatos que solo difieren en año
  // → elegir el más reciente. Razonamiento: cuando una tienda lista "WILSON BELA V3"
  // sin año está vendiendo la versión actual, que es la más reciente del catálogo.
  // Solo activamos la regla si todos los candidatos comparten marca+linea+modelo+variante
  // (diferencia ÚNICAMENTE en año). Si difieren en otro campo, seguimos siendo
  // ambiguos — no queremos falsos positivos.
  if (!attrs.año && filtrados.length > 1) {
    const claveSinAño = (p: any) =>
      `${(p.marca ?? '').toLowerCase()}|${(p.linea ?? '').toLowerCase()}|${(p.modelo ?? '').toLowerCase()}|${normalizarVariante(p.variante) ?? ''}`
    const claves = new Set(filtrados.map(claveSinAño))
    if (claves.size === 1) {
      // Todos iguales salvo año → quedarse con el de mayor año
      const masReciente = filtrados.reduce((best: any, p: any) =>
        (p.año ?? 0) > (best.año ?? 0) ? p : best
      )
      return [masReciente]
    }
  }

  return filtrados
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
  titulo: string; precio: number; url: string; tienda: string; imagen?: string | null
}, motivo: 'sin_match' | 'ambiguo', attrs: ReturnType<typeof extraerAtributos>, candidatos?: { id: string }[]) {
  if (DRY_RUN) return

  // "Borrador de pala" con todo lo extraído en el momento del scrap, para que
  // al promocionar la candidata se pueda crear la pala sin volver a investigar.
  const datosExtraidos = {
    marca:           attrs.marca,
    linea:           attrs.linea,
    modelo:          attrs.modelo,
    variante:        attrs.variante,
    año:             attrs.año,
    imagen_url:      producto.imagen ?? null,
    precio_pvp:      producto.precio,
    fuente:          producto.tienda,
    url_origen:      producto.url,
    candidatos_ids:  (candidatos ?? []).map(c => c.id),
    extraido_at:     new Date().toISOString(),
  }

  // No pisar candidatas ya resueltas — si estado='matched', la pala ya existe.
  // Si forzamos estado='pendiente' encima, el gestor la vuelve a mostrar como pendiente.
  const { data: existente } = await supabase
    .from('palas_candidatas')
    .select('id, estado')
    .eq('titulo_normalizado', normalizar(producto.titulo))
    .maybeSingle()
  if (existente?.estado === 'matched') return

  await supabase.from('palas_candidatas').upsert({
    titulo:             producto.titulo,
    titulo_normalizado: normalizar(producto.titulo),
    marca_detectada:    attrs.marca,
    precio_min:         producto.precio,
    precio_max:         producto.precio,
    fuentes:            [producto.tienda],
    urls:               [producto.url],
    estado:             motivo === 'ambiguo' ? 'ambiguo' : 'pendiente',
    datos_extraidos:    datosExtraidos,
    updated_at:         new Date().toISOString(),
  }, { onConflict: 'titulo_normalizado', ignoreDuplicates: false })
}

// ─── Scraper ─────────────────────────────────────────────────────────────────

async function scrape(tienda: string): Promise<{ title: string; price: number; precio_original?: number; url: string; image?: string | null }[]> {
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
        await insertarCandidata({ titulo: p.title, precio: p.price, url: p.url, tienda: TIENDA, imagen: p.image }, 'ambiguo', attrs, candidatos)
      }
      ambiguos++
    } else {
      // Sin match → Gestor
      if (DRY_RUN) {
        console.log(`  ❌ [sin match] ${p.title}`)
      } else {
        await insertarCandidata({ titulo: p.title, precio: p.price, url: p.url, tienda: TIENDA, imagen: p.image }, 'sin_match', attrs)
      }
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
