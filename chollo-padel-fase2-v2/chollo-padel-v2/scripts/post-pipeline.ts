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

async function autoPromover(): Promise<number> {
  const { data: candidatas } = await supabase
    .from('palas_candidatas')
    .select('id, titulo, datos_extraidos')
    .eq('estado', 'pendiente')
    .not('datos_extraidos->>marca', 'is', null)
    .order('datos_extraidos->>marca')
    .order('titulo')

  if (!candidatas?.length) return 0

  // Slugs existentes para unicidad
  const { data: slugsData } = await supabase.from('palas').select('slug')
  const usedSlugs = new Set(slugsData?.map(p => p.slug) ?? [])

  let insertadas = 0

  for (const c of candidatas) {
    const d = c.datos_extraidos as Record<string, any>
    const titulo = c.titulo as string
    const nombre = titulo.trim().toUpperCase()

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

  return insertadas
}

// ─── PASO 3: Reporte de pendientes restantes ──────────────────────────────────

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

async function main() {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  post-pipeline.ts${DRY_RUN ? '  [DRY RUN]' : ''}`)
  console.log(`${'─'.repeat(60)}\n`)

  // Cuántas pendientes hay al entrar
  const { count: totalPendientes } = await supabase
    .from('palas_candidatas')
    .select('*', { count: 'exact', head: true })
    .eq('estado', 'pendiente')

  if (!totalPendientes) {
    console.log('✅ No hay candidatas pendientes. Nada que hacer.\n')
    return
  }

  console.log(`📋 Candidatas pendientes al inicio: ${totalPendientes}\n`)

  // Paso 1
  console.log('── Paso 1: Limpiar false negatives ──────────────────────')
  const marcadas = await limpiarFalseNegatives()
  console.log(`   → ${marcadas} marcadas como matched\n`)

  // Paso 2
  console.log('── Paso 2: Auto-promover nuevas ─────────────────────────')
  const insertadas = await autoPromover()
  console.log(`   → ${insertadas} palas nuevas insertadas\n`)

  // Paso 3
  await reportarPendientes()

  // Resumen
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`✅ False negatives resueltos: ${marcadas}`)
  console.log(`✅ Palas nuevas insertadas:   ${insertadas}`)
  const restantes = (totalPendientes ?? 0) - marcadas - insertadas
  if (restantes > 0) {
    console.log(`⚠️  Pendientes sin resolver:   ${restantes}  (revisar a mano)`)
  }
  console.log(`${'─'.repeat(60)}\n`)
}

main().catch(err => {
  console.error('\n💥 Error fatal:', err)
  process.exit(1)
})
