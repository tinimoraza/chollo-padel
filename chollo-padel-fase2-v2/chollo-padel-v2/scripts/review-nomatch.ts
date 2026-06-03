/**
 * scripts/review-nomatch.ts
 * ===========================================
 * Resumen diario de calidad del matching.
 * Analiza TANTO los que matchearon (¿es correcto?) COMO los que no (¿por qué?).
 *
 * Ejecutar:
 *   npx tsx --env-file=.env.local scripts/review-nomatch.ts
 */

import { createClient } from '@supabase/supabase-js'
import {
  detectarMarcaDesideTitulo,
  matchearItem,
  extraerTokensModelo,
  tokenizar,
  TOKENS_DIFERENCIADORES,
  STOP_WORDS,
  KEEP_WORDS,
  EXCLUIR_ACCESORIOS,
  MARCAS_CONOCIDAS,
  type PalaCatalogo,
  type CacheItem,
} from './match-pala-id'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

// Umbral para señalar matches sospechosos: si el título tiene ≤ N tokens en común con el modelo → revisar
const SUSPICIOUS_OVERLAP = 2

async function main() {
  console.log('📋 REVIEW CALIDAD MATCHING')
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  // ── Cargar catálogo ───────────────────────────────────────────────────────
  const palasRaw: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase.from('palas').select('id, marca, modelo, año').range(from, from + 999)
    if (error || !data || data.length === 0) break
    palasRaw.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  const palas: PalaCatalogo[] = palasRaw.map(p => ({
    id: p.id, marca: p.marca, modelo: p.modelo, año: p.año,
    tokens: extraerTokensModelo(p.modelo, p.marca),
  }))
  const palasById = new Map(palas.map(p => [p.id, p]))
  const palasPorMarca = new Map<string, PalaCatalogo[]>()
  for (const pala of palas) {
    const m = pala.marca.toLowerCase()
    if (!palasPorMarca.has(m)) palasPorMarca.set(m, [])
    palasPorMarca.get(m)!.push(pala)
  }
  const starVie = palasPorMarca.get('star vie') ?? []
  if (starVie.length > 0) palasPorMarca.set('starvie', starVie)

  console.log(`📚 Catálogo: ${palas.length} palas\n`)

  // ══════════════════════════════════════════════════════════════════════════
  // PARTE 1 — ANÁLISIS DE MATCHES (fuzzy_auto) ¿son correctos?
  // ══════════════════════════════════════════════════════════════════════════

  const { data: matchados, error: matchErr } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, price, platform, marca, pala_id, match_method, scraped_at')
    .eq('match_method', 'fuzzy_auto')
    .not('pala_id', 'is', null)
    .order('scraped_at', { ascending: false })
    .limit(500)

  if (matchErr || !matchados) {
    console.error('❌ Error cargando matchados:', matchErr)
    process.exit(1)
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log('✅  PARTE 1 — QUÉ MATCHEÓ (fuzzy_auto, últimos 500)')
  console.log(`${'═'.repeat(70)}\n`)
  console.log(`Total matchados: ${matchados.length}\n`)

  // Detectar matches sospechosos: título con pocos tokens en común con el modelo
  const sospechosos: { title: string; modelo: string; año: number; overlap: number; price: number; platform: string }[] = []
  const matchSummary: { marca: string; count: number }[] = []
  const porMarcaMatch = new Map<string, number>()

  for (const item of matchados) {
    const pala = palasById.get(item.pala_id)
    if (!pala) continue

    porMarcaMatch.set(pala.marca, (porMarcaMatch.get(pala.marca) ?? 0) + 1)

    const tokensTitle = tokenizar(item.title.toLowerCase())
    const overlap = pala.tokens.filter(t => tokensTitle.includes(t)).length

    if (overlap <= SUSPICIOUS_OVERLAP) {
      sospechosos.push({
        title:    item.title,
        modelo:   pala.modelo,
        año:      pala.año,
        overlap,
        price:    Number(item.price),
        platform: item.platform,
      })
    }
  }

  // Resumen por marca
  console.log('📊 Matches por marca:')
  for (const [marca, count] of Array.from(porMarcaMatch.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${marca}: ${count}`)
  }

  // Matches sospechosos
  if (sospechosos.length > 0) {
    console.log(`\n⚠️  MATCHES SOSPECHOSOS (≤${SUSPICIOUS_OVERLAP} tokens en común): ${sospechosos.length}`)
    console.log('   (título y modelo asignado comparten muy pocos tokens — posible match incorrecto)\n')
    sospechosos.sort((a, b) => b.price - a.price)
    for (const s of sospechosos.slice(0, 30)) {
      console.log(`  💰 ${s.price}€ [${s.platform}] overlap:${s.overlap}`)
      console.log(`     Título:  "${s.title.substring(0, 70)}"`)
      console.log(`     Modelo:  ${s.modelo} [${s.año}]`)
      console.log()
    }
  } else {
    console.log('\n✅ No se detectaron matches sospechosos.')
  }

  // Muestra de los 30 matches más caros para revisión manual
  console.log('\n📋 Muestra top 30 por precio (para revisión manual):')
  const topPrecio = [...matchados]
    .sort((a, b) => Number(b.price) - Number(a.price))
    .slice(0, 30)
  for (const item of topPrecio) {
    const pala = palasById.get(item.pala_id)
    if (!pala) continue
    console.log(`  ${item.price}€ | ${item.platform}`)
    console.log(`     Título:  "${item.title.substring(0, 70)}"`)
    console.log(`     → ${pala.modelo} [${pala.año}]`)
    console.log()
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PARTE 2 — ANÁLISIS DE NO-MATCH ¿por qué no matchearon?
  // ══════════════════════════════════════════════════════════════════════════

  const { data: sinMatch, error: sinErr } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, price, platform, marca, match_method, scraped_at, url')
    .is('pala_id', null)
    .order('scraped_at', { ascending: false })
    .limit(2000)

  if (sinErr || !sinMatch) {
    console.error('❌ Error cargando sin-match:', sinErr)
    process.exit(1)
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log('❌  PARTE 2 — QUÉ NO MATCHEÓ Y POR QUÉ')
  console.log(`${'═'.repeat(70)}\n`)
  console.log(`Total sin pala_id: ${sinMatch.length}\n`)

  // Por estado
  const porEstado = new Map<string, number>()
  for (const item of sinMatch) {
    const m = item.match_method ?? 'sin_intentar'
    porEstado.set(m, (porEstado.get(m) ?? 0) + 1)
  }
  console.log('📊 Por estado:')
  for (const [m, n] of Array.from(porEstado.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${m}: ${n}`)
  }

  // Categorizar motivo de no-match
  const sinMarca:    string[] = []
  const sinCatalogo: string[] = []
  const descartDif:  string[] = []
  const ratioInsuf:  string[] = []
  const excluidos:   string[] = []

  for (const item of sinMatch) {
    const titleLow = item.title.toLowerCase()

    // Accesorios/excluidos
    if (Array.from(EXCLUIR_ACCESORIOS).some(w => titleLow.includes(w))) {
      excluidos.push(item.title)
      continue
    }

    let mNorm = item.marca?.toLowerCase() ?? null
    if (!mNorm) {
      const det = detectarMarcaDesideTitulo(item.title)
      if (det) mNorm = det.toLowerCase()
    }
    if (mNorm === 'star vie') mNorm = 'starvie'

    if (!mNorm) {
      sinMarca.push(item.title)
      continue
    }

    const candidatos = palasPorMarca.get(mNorm) ?? []
    if (candidatos.length === 0) {
      sinCatalogo.push(`[${mNorm}] ${item.title}`)
      continue
    }

    // ¿Tiene candidatos con ratio suficiente pero bloqueados por diferenciador?
    const tokensT = tokenizar(titleLow)
    const difT = new Set(tokensT.filter(t => TOKENS_DIFERENCIADORES.has(t)))
    const conRatio = candidatos.filter(p => {
      const tm = p.tokens.filter(t => tokensT.includes(t))
      return p.tokens.length > 0 && tm.length / p.tokens.length >= 0.6
    })

    if (conRatio.length > 0) {
      descartDif.push(item.title)
    } else {
      ratioInsuf.push(item.title)
    }
  }

  console.log('\n📊 Motivos de no-match:')
  console.log(`  🔴 Sin marca detectada:          ${sinMarca.length}`)
  console.log(`  🟠 Marca sin palas en catálogo:  ${sinCatalogo.length}`)
  console.log(`  🟡 Bloqueado por diferenciador:  ${descartDif.length}`)
  console.log(`  ⚫ Ratio tokens insuficiente:    ${ratioInsuf.length}`)
  console.log(`  🚫 Accesorios/excluidos:         ${excluidos.length}`)

  // Marcas sin catálogo — las más importantes para importar
  if (sinCatalogo.length > 0) {
    const porMarcaSC = new Map<string, number>()
    for (const t of sinCatalogo) {
      const marca = t.match(/^\[([^\]]+)\]/)?.[1] ?? 'desconocida'
      porMarcaSC.set(marca, (porMarcaSC.get(marca) ?? 0) + 1)
    }
    console.log('\n  🟠 Marcas sin catálogo (anuncios afectados):')
    for (const [m, n] of Array.from(porMarcaSC.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`     ${m}: ${n} anuncios`)
    }
  }

  // Muestra de sin marca
  if (sinMarca.length > 0) {
    console.log('\n  🔴 Sin marca (muestra 20):')
    for (const t of sinMarca.slice(0, 20)) console.log(`     "${t.substring(0, 80)}"`)
  }

  // Muestra de diferenciador bloqueante
  if (descartDif.length > 0) {
    console.log('\n  🟡 Bloqueados por diferenciador (muestra 20):')
    for (const t of descartDif.slice(0, 20)) console.log(`     "${t.substring(0, 80)}"`)
  }

  // Muestra de ratio insuficiente
  if (ratioInsuf.length > 0) {
    console.log('\n  ⚫ Ratio insuficiente (muestra 20):')
    for (const t of ratioInsuf.slice(0, 20)) console.log(`     "${t.substring(0, 80)}"`)
  }

  // Items ≥100€ sin match — potenciales chollos perdidos
  const altoPrecio = sinMatch
    .filter(i => Number(i.price) >= 100)
    .sort((a, b) => Number(b.price) - Number(a.price))
    .slice(0, 20)

  if (altoPrecio.length > 0) {
    console.log('\n💎 Items ≥100€ sin match (potenciales chollos perdidos):')
    for (const item of altoPrecio) {
      console.log(`  ${item.price}€ | ${item.platform} | "${item.title.substring(0, 65)}"`)
    }
  }

  // Por plataforma
  const porPlat = new Map<string, number>()
  for (const item of sinMatch) porPlat.set(item.platform ?? 'unknown', (porPlat.get(item.platform ?? 'unknown') ?? 0) + 1)
  console.log('\n📊 Sin match por plataforma:')
  for (const [p, n] of Array.from(porPlat.entries())) console.log(`  ${p}: ${n}`)

  console.log('\n✅ Review completado.')
}

main().catch(err => {
  console.error('❌ Error fatal:', err)
  process.exit(1)
})
