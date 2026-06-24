/**
 * scripts/post-pipeline.ts
 * =============================================================================
 * Paso automático post-scrape. Ejecutar tras pipeline-tiendas.ts.
 *
 * Hace dos cosas en orden:
 *
 *  PASO 1 — Limpiar false negatives
 *    Candidatas pendientes cuya marca+linea+modelo ya existe en catálogo
 *    (el pipeline no las matcheó por diferencia de escritura o año distinto).
 *    → se marcan como 'matched', no se insertan.
 *
 *  PASO 2 — Auto-promover nuevas de alta confianza
 *    Candidatas pendientes con marca reconocida que genuinamente no existen
 *    en catálogo → se insertan en `palas`, se crea alias, se marca como matched.
 *    Quedan sin tocar: las que tienen marca=null o linea=null.
 *
 *  PASO 3 — Reporte de lo que queda pendiente
 *    Lo que no se pudo resolver automáticamente (sin marca, etc.) se lista
 *    para revisión manual.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/post-pipeline.ts
 *   npx tsx --env-file=.env.local scripts/post-pipeline.ts --dry-run
 *
 * Encadenar con el pipeline:
 *   npx tsx --env-file=.env.local scripts/pipeline-tiendas.ts padelnuestro && \
 *   npx tsx --env-file=.env.local scripts/post-pipeline.ts
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js'
import { normalizar } from './extract-atributos'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const DRY_RUN = process.argv.includes('--dry-run')
const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgo'

// Equivalencias de variante para la comparación (mismo criterio que el pipeline)
const VARIANTE_EQUIV: Record<string, string> = {
  'control': 'ctrl', 'ctrl': 'ctrl',
  'woman': 'woman', 'women': 'woman', 'mujer': 'woman',
}

function normVar(v: string | null | undefined): string | null {
  if (!v) return null
  return VARIANTE_EQUIV[v.toLowerCase().trim()] ?? v.toLowerCase().trim()
}

function slugify(texto: string): string {
  return texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ─── PASO 1: Limpiar false negatives ─────────────────────────────────────────

async function limpiarFalseNegatives(): Promise<number> {
  const { data: candidatas } = await supabase
    .from('palas_candidatas')
    .select('id, titulo, datos_extraidos')
    .eq('estado', 'pendiente')
    .not('datos_extraidos->>marca', 'is', null)

  if (!candidatas?.length) return 0

  // Cargar catálogo para comparar en memoria
  const { data: catalogo } = await supabase
    .from('palas')
    .select('id, marca, linea, modelo, variante, año')
    .not('linea', 'is', null)

  let marcadas = 0

  for (const c of candidatas) {
    const d = c.datos_extraidos as Record<string, any>
    if (!d.marca || !d.linea) continue

    const match = (catalogo ?? []).find(p => {
      if (p.marca !== d.marca) return false
      if (!p.linea || p.linea.toLowerCase() !== d.linea?.toLowerCase()) return false
      if (d.modelo && p.modelo && p.modelo.toLowerCase() !== d.modelo.toLowerCase()) return false
      if (normVar(d.variante) !== normVar(p.variante)) return false
      const añoOk = !d.año || !p.año || String(p.año) === String(d.año)
      return añoOk
    })

    if (match) {
      console.log(`  🔗 [ya existe] ${c.titulo} → ${match.id}`)
      if (!DRY_RUN) {
        await supabase.from('palas_candidatas').update({
          estado:          'matched',
          revisada_at:     new Date().toISOString(),
          datos_extraidos: { ...d, pala_id_promovida: match.id },
        }).eq('id', c.id)
      }
      marcadas++
    }
  }

  return marcadas
}

// ─── PASO 2: Auto-promover nuevas ────────────────────────────────────────────

// Similaridad por tokens con prefijo parcial (sin dependencias externas)
function tokenSim(a: string, b: string): number {
  const ta = normalizar(a).split(/\s+/).filter(t => t.length > 1)
  const tb = new Set(normalizar(b).split(/\s+/).filter(t => t.length > 1))
  let hits = 0
  for (const t of ta) {
    if (tb.has(t) || [...tb].some(u => u.startsWith(t) || t.startsWith(u))) hits++
  }
  const total = Math.max(ta.length, tb.size)
  return total === 0 ? 0 : (hits / total) * 100
}

async function autoPromover(): Promise<number> {
  const { data: candidatas } = await supabase
    .from('palas_candidatas')
    .select('id, titulo, datos_extraidos')
    .eq('estado', 'pendiente')
    .not('datos_extraidos->>marca', 'is', null)
    .order('datos_extraidos->>marca')
    .order('titulo')

  if (!candidatas?.length) return 0

  // Palas existentes (para dedup fuzzy y unicidad de slug)
  const { data: palasExistentes } = await supabase.from('palas').select('id, slug, nombre, marca')
  const usedSlugs = new Set(palasExistentes?.map(p => p.slug) ?? [])
  const palasPool = palasExistentes ?? []

  let insertadas = 0
  let aliasResueltas = 0

  for (const c of candidatas) {
    const d = c.datos_extraidos as Record<string, any>
    const titulo = c.titulo as string
    const nombre = titulo.replace(/^pala\s+/i, '').trim().toUpperCase()

    // Guardia: comprobar si ya existe alias para esta candidata
    const { data: aliasExistente } = await supabase
      .from('producto_aliases')
      .select('pala_id')
      .eq('tienda', d.fuente ?? 'padelnuestro')
      .eq('texto_normalizado', normalizar(titulo))
      .maybeSingle()

    if (aliasExistente) {
      console.log(`  🔗 [alias ya existe] ${nombre}`)
      if (!DRY_RUN) {
        await supabase.from('palas_candidatas').update({
          estado:          'matched',
          revisada_at:     new Date().toISOString(),
          datos_extraidos: { ...d, pala_id_promovida: aliasExistente.pala_id },
        }).eq('id', c.id)
      }
      aliasResueltas++
      continue
    }

    // Guardia: linea='Pala' indica extracción fallida (prefijo genérico mal parseado).
    // No auto-promover estas — irán al Gestor para revisión manual.
    if (!d.linea || d.linea === 'Pala' || d.linea === 'pala') {
      continue
    }

    // Guardia fuzzy: si ya existe una pala similar de la misma marca, no insertar
    const sameMarca = palasPool.filter(p => (p.marca ?? '').toLowerCase() === (d.marca ?? '').toLowerCase())
    const dupFuzzy = sameMarca.find(p => tokenSim(nombre, p.nombre) >= 78)
    if (dupFuzzy) {
      const fuente = d.fuente ?? 'tienda'
      const textoNorm = normalizar(titulo)
      if (!DRY_RUN) {
        const { data: aliasYa } = await supabase.from('producto_aliases')
          .select('id').eq('pala_id', dupFuzzy.id).eq('texto_normalizado', textoNorm).maybeSingle()
        if (!aliasYa) {
          await supabase.from('producto_aliases').insert({
            pala_id: dupFuzzy.id, texto_original: titulo,
            texto_normalizado: textoNorm, tienda: fuente,
            fuente_url: d.url_origen ?? null, confianza: 0.85,
          })
        }
        await supabase.from('palas_candidatas').update({
          estado: 'matched', revisada_at: new Date().toISOString(),
          datos_extraidos: { ...d, pala_id_promovida: dupFuzzy.id },
        }).eq('id', c.id)
      }
      console.log(`  🔗 [dup→match] ${nombre} → ${dupFuzzy.nombre}`)
      aliasResueltas++
      continue
    }

    // Slug único
    let slug = slugify(nombre)
    if (usedSlugs.has(slug)) {
      let i = 2
      while (usedSlugs.has(`${slug}-${i}`)) i++
      slug = `${slug}-${i}`
    }

    const imagenUrl: string | null = d.imagen_url ?? null
    const esPlaceholder = imagenUrl?.startsWith(PLACEHOLDER)

    const nuevaPala = {
      slug,
      nombre,
      marca:      d.marca,
      linea:      d.linea ?? null,
      modelo:     d.modelo ?? null,
      variante:   d.variante ?? null,
      año:        d.año ? parseInt(d.año, 10) : null,
      imagen_url: imagenUrl,
      precio_pvp: d.precio_pvp ? parseFloat(d.precio_pvp) : null,
      fuente:     d.fuente ?? 'tienda',
    }

    const tag = esPlaceholder ? ' ⚠️ sin imagen' : ''
    console.log(`  ✅ [nueva] ${nombre}${tag}`)

    if (DRY_RUN) {
      usedSlugs.add(slug)
      insertadas++
      continue
    }

    const { data: palaInsertada, error: errPala } = await supabase
      .from('palas')
      .insert(nuevaPala)
      .select('id')
      .single()

    if (errPala || !palaInsertada) {
      console.log(`  ❌ Error insertando ${titulo}: ${errPala?.message}`)
      continue
    }

    usedSlugs.add(slug)

    await supabase.from('producto_aliases').insert({
      pala_id:           palaInsertada.id,
      texto_original:    titulo,
      texto_normalizado: normalizar(titulo),
      tienda:            d.fuente ?? 'padelnuestro',
      fuente_url:        d.url_origen ?? null,
      confianza:         1.0,
    })

    await supabase.from('palas_candidatas').update({
      estado:          'matched',
      revisada_at:     new Date().toISOString(),
      datos_extraidos: { ...d, pala_id_promovida: palaInsertada.id },
    }).eq('id', c.id)

    insertadas++
  }

  return { insertadas, aliasResueltas }
}

// ─── PASO 3: Recalcular precios de referencia ────────────────────────────────

// Fuentes excluidas del precio_referencia (precio medio):
//   2 = PadelZoom (agregador, no tienda directa — no refleja precio real de venta)
const FUENTES_EXCLUIR_REFERENCIA = new Set([2])

async function recalcularPrecios(): Promise<number> {
  if (DRY_RUN) return 0

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: rows } = await supabase
    .from('price_snapshots')
    .select('pala_id')
    .eq('disponible', true)
    .gte('scraped_at', since)

  const palaIds = [...new Set((rows ?? []).map((r: any) => r.pala_id))]
  if (!palaIds.length) return 0

  let actualizadas = 0

  for (const palaId of palaIds) {
    const { data: snaps } = await supabase
      .from('price_snapshots')
      .select('precio, source_id, url_producto')
      .eq('pala_id', palaId)
      .eq('disponible', true)
      .gte('scraped_at', since)

    if (!snaps?.length) continue

    // Para precio_referencia: excluir fuentes que distorsionan; si quedan 0, usar todas
    const snapsRef = snaps.filter((s: any) => !FUENTES_EXCLUIR_REFERENCIA.has(s.source_id))
    const snapsFuente = snapsRef.length > 0 ? snapsRef : snaps

    const preciosRef = snapsFuente.map((s: any) => Number(s.precio))
    const precio_referencia = parseFloat(
      (preciosRef.reduce((a: number, b: number) => a + b, 0) / preciosRef.length).toFixed(2)
    )
    const precio_minimo = Math.min(...snaps.map((s: any) => Number(s.precio)))
    const fuentes_count = new Set(snaps.map((s: any) => s.source_id)).size

    await supabase.from('price_reference').upsert({
      pala_id:          palaId,
      precio_referencia,
      precio_minimo,
      precio_maximo:    Math.max(...snaps.map((s: any) => Number(s.precio))),
      fuentes_count,
      updated_at:       new Date().toISOString(),
    }, { onConflict: 'pala_id' })

    await supabase.from('palas').update({
      precio_referencia,
      precio_minimo_tiendas: precio_minimo,
      precios_updated_at:    new Date().toISOString(),
    }).eq('id', palaId)

    actualizadas++
  }

  return actualizadas
}

// ─── PASO 4: Reporte de pendientes restantes ──────────────────────────────────

async function reportarPendientes() {
  const { data } = await supabase
    .from('palas_candidatas')
    .select('titulo, datos_extraidos')
    .eq('estado', 'pendiente')
    .order('titulo')

  if (!data?.length) return

  console.log(`\n  ⚠️  Pendientes que requieren revisión manual (${data.length}):`)
  for (const c of data) {
    const d = c.datos_extraidos as Record<string, any>
    const motivo = !d.marca ? 'sin marca' : !d.linea ? 'sin línea' : 'otro'
    console.log(`     • ${c.titulo}  [${motivo}]`)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function main() {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  post-pipeline.ts${DRY_RUN ? '  [DRY RUN]' : ''}`)
  console.log(`${'─'.repeat(60)}\n`)

  // Cuántas pendientes hay al entrar
  const { count: totalPendientes } = await supabase
    .from('palas_candidatas')
    .select('*', { count: 'exact', head: true })
    .eq('estado', 'pendiente')

  // Fix root-cause 2026-06-24: antes, si no había candidatas pendientes, la
  // función entera se cortaba aquí con un `return` — y eso se saltaba TAMBIÉN
  // el Paso 3 (recalcular precio_referencia), que no depende en absoluto de
  // las candidatas pendientes, sino de los price_snapshots recién escritos
  // por el scrape. Resultado real: cualquier vez que la cola de candidatas
  // estuviera vacía (cada vez más habitual, porque el Gestor la vacía a
  // mano), el post-pipeline terminaba en ~2s SIN recalcular precio_referencia
  // para ninguna pala, dejando ese campo (y por tanto el % de descuento de
  // /chollos) desactualizado de forma silenciosa — el job seguía marcando
  // "success" en GitHub Actions. Ahora los Pasos 1-2 (que sí dependen de
  // candidatas) se saltan si no hay pendientes, pero el Paso 3 se ejecuta
  // siempre.
  let marcadas = 0
  if (!totalPendientes) {
    console.log('✅ No hay candidatas pendientes — se salta Paso 1/2.\n')
  } else {
    console.log(`📋 Candidatas pendientes al inicio: ${totalPendientes}\n`)

    // Paso 1
    console.log('── Paso 1: Limpiar false negatives ──────────────────────')
    marcadas = await limpiarFalseNegatives()
    console.log(`   → ${marcadas} marcadas como matched\n`)

    // Paso 2 — AUTO-PROMOVER DESACTIVADO
    // Las candidatas sin match van al Gestor para revisión manual.
    console.log('── Paso 2: Auto-promover nuevas ── DESACTIVADO (usar Gestor)')
  }

  // Paso 3
  console.log('── Paso 3: Recalcular precios de referencia ─────────────')
  const actualizadas = await recalcularPrecios()
  console.log(`   → ${DRY_RUN ? '(dry-run)' : actualizadas + ' palas actualizadas'}\n`)

  // Paso 4
  await reportarPendientes()

  // Resumen
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`✅ False negatives resueltos: ${marcadas}`)
  console.log(`✅ Precios recalculados:      ${actualizadas}`)
  console.log(`${'─'.repeat(60)}\n`)
}

// Solo ejecutar si se llama directamente (no cuando se importa)
if (process.argv[1]?.endsWith('post-pipeline.ts')) {
  main().catch(err => {
    console.error('\n💥 Error fatal:', err)
    process.exit(1)
  })
}
