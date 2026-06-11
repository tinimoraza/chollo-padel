// scripts/_analyze-coverage.ts — análisis de cobertura de precios
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)

async function main() {
  // 1. Distribución de fuentes_count (paginado)
  const refs: {fuentes_count: number, precio_referencia: number|null, pala_id: string}[] = []
  { let off = 0
    while (true) {
      const { data } = await sb.from('price_reference')
        .select('pala_id,fuentes_count,precio_referencia').range(off, off + 999)
      if (!data || data.length === 0) break
      refs.push(...data)
      if (data.length < 1000) break
      off += 1000
    }
  }
  const byFuentes: Record<number, number> = {}
  for (const r of refs ?? []) {
    byFuentes[r.fuentes_count] = (byFuentes[r.fuentes_count] ?? 0) + 1
  }
  console.log('\n=== Distribución fuentes_count ===')
  for (const [k, v] of Object.entries(byFuentes).sort((a,b) => +a[0]-+b[0])) {
    console.log(`  ${k} fuentes: ${v} palas`)
  }
  const con2 = Object.entries(byFuentes).filter(([k]) => +k >= 2).reduce((a,[,v]) => a+v, 0)
  const con3 = Object.entries(byFuentes).filter(([k]) => +k >= 3).reduce((a,[,v]) => a+v, 0)
  console.log(`  ≥2 fuentes: ${con2} | ≥3 fuentes: ${con3}`)

  // 2. Palas sin precio
  const { count: totalPalas } = await sb.from('palas').select('*', { count: 'exact', head: true })
  console.log(`\n=== Cobertura palas ===`)
  console.log(`  Total palas: ${totalPalas}`)
  console.log(`  Con precio_referencia: ${refs?.length ?? 0}`)
  console.log(`  Sin precio_referencia: ${(totalPalas ?? 0) - (refs?.length ?? 0)}`)

  // 3. Chollos y ofertas (snapshots disponibles vs precio_referencia) — paginado
  const snaps: {pala_id: string, precio: number, source_id: number}[] = []
  { let off = 0
    while (true) {
      const { data } = await sb.from('price_snapshots')
        .select('pala_id,precio,source_id').eq('disponible', true).range(off, off + 999)
      if (!data || data.length === 0) break
      snaps.push(...data)
      if (data.length < 1000) break
      off += 1000
    }
  }

  const refMapById = new Map(refs.map(r => [r.pala_id, r]))

  const EXCLUIR = new Set([2, 9])
  let chollos = 0, ofertas = 0, checked = 0
  for (const s of snaps) {
    if (EXCLUIR.has(s.source_id)) continue
    const ref = refMapById.get(s.pala_id)
    if (!ref?.precio_referencia || (ref.fuentes_count ?? 0) < 2) continue
    checked++
    const ratio = s.precio / ref.precio_referencia
    if (ratio <= 0.70) chollos++
    else if (ratio <= 0.82) ofertas++
  }
  console.log(`\n=== Chollos y ofertas (snapshots con ≥2 fuentes) ===`)
  console.log(`  Snapshots analizados: ${checked}`)
  console.log(`  Chollos (≤70%): ${chollos}`)
  console.log(`  Ofertas (70-82%): ${ofertas}`)

  // 4. Top tiendas por cobertura (paginado para esquivar límite 1000 rows)
  const allSnaps: {source_id: number}[] = []
  { let off = 0
    while (true) {
      const { data } = await sb.from('price_snapshots').select('source_id')
        .eq('disponible', true).range(off, off + 999)
      if (!data || data.length === 0) break
      allSnaps.push(...data)
      if (data.length < 1000) break
      off += 1000
    }
  }
  const bySource: Record<number, number> = {}
  for (const s of allSnaps) {
    bySource[s.source_id] = (bySource[s.source_id] ?? 0) + 1
  }
  const { data: sources } = await sb.from('price_sources').select('id, slug')
  const slugMap = new Map((sources ?? []).map(s => [s.id, s.slug]))
  console.log(`\n=== Snapshots por tienda ===`)
  for (const [id, cnt] of Object.entries(bySource).sort((a,b) => +b[1]-+a[1])) {
    console.log(`  ${slugMap.get(+id) ?? id}: ${cnt}`)
  }
}

main().catch(console.error)
