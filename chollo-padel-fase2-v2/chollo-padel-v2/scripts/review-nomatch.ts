/**
 * scripts/review-nomatch.ts
 * ===========================================
 * Resumen diario (07:00) de anuncios sin pala_id asignado.
 * Agrupa por marca detectada para identificar qué modelos
 * faltan en el catálogo o necesitan ajuste en el matcher.
 *
 * Ejecutar:
 *   npx tsx --env-file=.env.local scripts/review-nomatch.ts
 */

import { createClient } from '@supabase/supabase-js'
import { detectarMarcaDesideTitulo } from './match-pala-id'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

async function main() {
  console.log('📋 REVIEW NO-MATCH DIARIO')
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  // Cargar todos los anuncios sin match (no_match + ambiguous + null)
  const { data: items, error } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, price, platform, marca, match_method, scraped_at, url')
    .is('pala_id', null)
    .order('scraped_at', { ascending: false })
    .limit(2000)

  if (error || !items) {
    console.error('❌ Error cargando items:', error)
    process.exit(1)
  }

  console.log(`📊 Total sin pala_id: ${items.length}\n`)

  // Agrupar por match_method
  const porMetodo = new Map<string, number>()
  for (const item of items) {
    const m = item.match_method ?? 'sin_intentar'
    porMetodo.set(m, (porMetodo.get(m) ?? 0) + 1)
  }
  console.log('📊 Por estado:')
  for (const [m, n] of Array.from(porMetodo.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${m}: ${n}`)
  }

  // Agrupar por marca detectada
  const porMarca = new Map<string, { count: number; ejemplos: string[] }>()
  for (const item of items) {
    let marca = item.marca
    if (!marca) {
      marca = detectarMarcaDesideTitulo(item.title) ?? '⚠️ sin marca'
    }
    if (!porMarca.has(marca)) porMarca.set(marca, { count: 0, ejemplos: [] })
    const entry = porMarca.get(marca)!
    entry.count++
    if (entry.ejemplos.length < 5) entry.ejemplos.push(item.title)
  }

  const sorted = Array.from(porMarca.entries()).sort((a, b) => b[1].count - a[1].count)

  console.log('\n📊 Por marca (anuncios sin match):')
  for (const [marca, { count, ejemplos }] of sorted) {
    console.log(`\n  ${marca}: ${count} anuncios`)
    for (const ej of ejemplos) {
      console.log(`    · "${ej.substring(0, 70)}"`)
    }
  }

  // Resumen de plataforma
  const porPlataforma = new Map<string, number>()
  for (const item of items) {
    const p = item.platform ?? 'unknown'
    porPlataforma.set(p, (porPlataforma.get(p) ?? 0) + 1)
  }
  console.log('\n📊 Por plataforma:')
  for (const [p, n] of Array.from(porPlataforma.entries())) {
    console.log(`  ${p}: ${n}`)
  }

  // Items de precio alto sin match (potenciales chollos perdidos)
  const altoPrecio = items
    .filter(i => Number(i.price) >= 100)
    .sort((a, b) => Number(b.price) - Number(a.price))
    .slice(0, 20)

  if (altoPrecio.length > 0) {
    console.log('\n💎 Items ≥100€ sin match (potenciales chollos perdidos):')
    for (const item of altoPrecio) {
      console.log(`  ${item.price}€ | ${item.platform} | "${item.title.substring(0, 60)}"`)
    }
  }

  console.log('\n✅ Review completado.')
}

main().catch(err => {
  console.error('❌ Error fatal:', err)
  process.exit(1)
})
