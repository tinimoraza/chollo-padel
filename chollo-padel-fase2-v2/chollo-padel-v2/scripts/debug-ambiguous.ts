/**
 * scripts/debug-ambiguous.ts
 * Vuelca los casos ambiguos con sus candidatos para entender los patrones.
 * 
 * Ejecutar:
 *   npx tsx --env-file=.env.local scripts/debug-ambiguous.ts
 *   npx tsx --env-file=.env.local scripts/debug-ambiguous.ts --top 50
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const TOP = parseInt(process.argv.find(a => a.startsWith('--top'))?.split('=')[1] ?? process.argv[process.argv.indexOf('--top') + 1] ?? '30')

const STOP_WORDS = new Set([
  'de', 'da', 'del', 'la', 'el', 'y', 'e', 'con', 'para', 'pala', 'padel',
  'raqueta', 'serie', 'series', 'edition', 'version', 'by',
])
const KEEP_WORDS = new Set([
  'hrd', 'ctrl', 'soft', 'air', 'light', 'team', 'carbon',
  'match', 'drive', 'arrow', 'cross', 'hit', 'rx',
  '18k', '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena', 'hard',
  'pro', 'evo', 'plus', 'motion', 'elite', 'genius', 'attack',
])
const TOKENS_DIF = new Set([
  'ctrl', 'carbon', 'team', 'hrd', 'light', 'soft', 'air',
  'pro', 'elite', 'attack', 'motion', 'drive', 'match',
  'arrow', 'cross', 'hit', 'rx', 'hybrid', 'power', 'speed',
  '18k', '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena',
])
const EXCLUIR = new Set([
  'bolsa', 'mochila', 'funda', 'paletero', 'grip', 'overgrip',
  'protector', 'muñequera', 'bolas', 'pelota', 'pelotas', 'camiseta',
  'zapatilla', 'zapatillas', 'ropa', 'lote', 'pack', 'antivibrador',
])
const VERSION_SUFFIXES = /\b(3\.4|3\.0|2\.6|2\.0|1\.0)\b/gi

function tokenizar(texto: string): string[] {
  return texto
    .toLowerCase()
    .replace(/hrd\+/g, 'hrd')
    .replace(/\bctr\b/g, 'ctrl')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2)
    .filter(t =>
      KEEP_WORDS.has(t) ||
      (!STOP_WORDS.has(t) && (!/^\d+$/.test(t) || /^0[1-9]$/.test(t)))
    )
}

function extraerAnio(texto: string): number | null {
  const m = texto.match(/\b(20(1[89]|2[0-9]))\b/)
  return m ? parseInt(m[1]) : null
}

function extraerTokensModelo(modelo: string, marca: string): string[] {
  const sinMarca   = modelo.replace(new RegExp(`^${marca}\\s+`, 'i'), '')
  const sinAnio    = sinMarca.replace(/\b20\d{2}\b/, '').trim()
  const sinJugador = sinAnio.replace(
    /\b(juan lebron|ale galan|ale galán|martita ortega|alex ruiz|agustin tapia|agustín tapia)\b/gi, ''
  ).trim()
  const sinVersion = sinJugador.replace(VERSION_SUFFIXES, '').trim()
  return tokenizar(sinVersion)
}

interface Pala { id: string; marca: string; modelo: string; año: number; tokens: string[] }
interface Item  { external_id: string; title: string; marca: string | null }

// Categorías de ambigüedad para entender el patrón
type AmbigCategory =
  | 'mismo_modelo_distintos_años'   // "Bullpadel Hack 03" matchea 2022, 2023, 2024
  | 'variantes_sin_dif_en_titulo'   // título sin token diferenciador → base + variante empatan
  | 'jugadores'                      // modelo con nombre jugador vs sin nombre
  | 'otro'

function categorizarAmbiguos(
  titulo: string,
  candidatos: Pala[]
): AmbigCategory {
  const años = new Set(candidatos.map(p => p.año))
  if (años.size > 1 && candidatos.every((p, _, arr) =>
    arr.some(q => q.id !== p.id && q.modelo.replace(/\b20\d{2}\b/, '').trim() === p.modelo.replace(/\b20\d{2}\b/, '').trim())
  )) return 'mismo_modelo_distintos_años'

  const tieneJugador = (m: string) =>
    /juan lebron|ale galan|martita ortega|alex ruiz|agustin tapia/i.test(m)
  if (candidatos.some(tieneJugador) && candidatos.some(p => !tieneJugador(p.modelo)))
    return 'jugadores'

  const difTitulo = new Set(tokenizar(titulo).filter(t => TOKENS_DIF.has(t)))
  if (difTitulo.size === 0) return 'variantes_sin_dif_en_titulo'

  return 'otro'
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  console.log('📚 Cargando catálogo...')
  const { data: palasRaw } = await supabase.from('palas').select('id, marca, modelo, año')
  const palas: Pala[] = palasRaw!.map((p: any) => ({
    ...p, tokens: extraerTokensModelo(p.modelo, p.marca),
  }))
  const porMarca = new Map<string, Pala[]>()
  for (const p of palas) {
    const m = p.marca.toLowerCase()
    if (!porMarca.has(m)) porMarca.set(m, [])
    porMarca.get(m)!.push(p)
  }

  console.log('📦 Cargando wallapop_cache sin pala_id...')
  const { data: items } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, marca')
    .is('pala_id', null)

  const ambiguos: {
    titulo: string
    marca: string
    anio: number | null
    tokensTitle: string[]
    candidatos: Pala[]
    category: AmbigCategory
  }[] = []

  for (const item of (items ?? []) as Item[]) {
    const tl = item.title.toLowerCase()
    if ([...EXCLUIR].some(w => tl.includes(w))) continue
    const marcaNorm = item.marca?.toLowerCase()
    if (!marcaNorm) continue
    const candidatas = porMarca.get(marcaNorm) ?? []
    if (!candidatas.length) continue

    const anioTitulo  = extraerAnio(item.title)
    const tokensTitle = tokenizar(tl)
    const difEnTitulo = new Set(tokensTitle.filter(t => TOKENS_DIF.has(t)))

    let scored = candidatas
      .map(pala => {
        if (anioTitulo !== null && pala.año !== anioTitulo) return null
        const tokensMatch = pala.tokens.filter(t => tokensTitle.includes(t))
        if (tokensMatch.length < pala.tokens.length || tokensMatch.length === 0) return null
        const tokensDif = pala.tokens.filter(t => TOKENS_DIF.has(t))
        if (!tokensDif.every(t => tokensTitle.includes(t))) return null
        return { pala, score: pala.tokens.length }
      })
      .filter(Boolean) as { pala: Pala; score: number }[]

    if (!scored.length) continue

    // Fix HRD/Team
    if (difEnTitulo.size > 0) {
      const conDif = scored.filter(s => s.pala.tokens.some(t => TOKENS_DIF.has(t)))
      if (conDif.length > 0) scored = conDif
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const extraA = a.pala.tokens.filter(t => !tokensTitle.includes(t)).length
      const extraB = b.pala.tokens.filter(t => !tokensTitle.includes(t)).length
      return extraA - extraB
    })

    const maxScore    = scored[0].score
    const topMatches  = scored.filter(s => s.score === maxScore)
    const topSinExtra = topMatches.filter(s =>
      s.pala.tokens.filter(t => !tokensTitle.includes(t)).length ===
      topMatches[0].pala.tokens.filter(t => !tokensTitle.includes(t)).length
    )

    if (topSinExtra.length > 1) {
      ambiguos.push({
        titulo:      item.title,
        marca:       marcaNorm,
        anio:        anioTitulo,
        tokensTitle,
        candidatos:  topSinExtra.map(s => s.pala),
        category:    categorizarAmbiguos(item.title, topSinExtra.map(s => s.pala)),
      })
    }
  }

  // ── Resumen por categoría ──────────────────────────────────────────────────
  const conteo: Record<AmbigCategory, number> = {
    mismo_modelo_distintos_años:  0,
    variantes_sin_dif_en_titulo:  0,
    jugadores:                     0,
    otro:                          0,
  }
  for (const a of ambiguos) conteo[a.category]++

  console.log(`\n⚠️  ${ambiguos.length} casos ambiguos — desglose:`)
  console.log(`  📅 Mismo modelo, distintos años : ${conteo.mismo_modelo_distintos_años}`)
  console.log(`  🔀 Variantes (sin dif en título): ${conteo.variantes_sin_dif_en_titulo}`)
  console.log(`  👤 Con nombre jugador vs sin él : ${conteo.jugadores}`)
  console.log(`  ❓ Otros                        : ${conteo.otro}`)

  // ── Detalle de los primeros N de cada categoría ────────────────────────────
  const cats: AmbigCategory[] = [
    'mismo_modelo_distintos_años',
    'variantes_sin_dif_en_titulo',
    'jugadores',
    'otro',
  ]
  const labels: Record<AmbigCategory, string> = {
    mismo_modelo_distintos_años:  '📅 Mismo modelo, distintos años',
    variantes_sin_dif_en_titulo:  '🔀 Variantes sin diferenciador en título',
    jugadores:                     '👤 Jugador vs sin jugador',
    otro:                          '❓ Otros',
  }

  for (const cat of cats) {
    const lista = ambiguos.filter(a => a.category === cat).slice(0, Math.min(8, TOP))
    if (!lista.length) continue
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`${labels[cat]} (mostrando ${lista.length})`)
    console.log('─'.repeat(60))
    for (const a of lista) {
      console.log(`\n  Título : "${a.titulo}"`)
      console.log(`  Tokens : [${a.tokensTitle.join(', ')}]`)
      console.log(`  Año    : ${a.anio ?? 'no especificado'}`)
      console.log(`  Candidatos ambiguos (${a.candidatos.length}):`)
      for (const c of a.candidatos) {
        console.log(`    • "${c.modelo}" (año ${c.año}) tokens:[${c.tokens.join(', ')}]`)
      }
    }
  }

  // ── Análisis adicional: ¿cuántos se resolverían solo con año? ─────────────
  const resolublesConAnio = ambiguos.filter(a =>
    a.category === 'mismo_modelo_distintos_años' && a.anio === null
  )
  console.log(`\n\n📊 Análisis de resolución:`)
  console.log(`  • "Mismo año" sin año en título → ${resolublesConAnio.length} se resolverían si el anuncio pusiera el año`)
  
  const resolublesConJugador = ambiguos.filter(a => a.category === 'jugadores')
  console.log(`  • Jugadores → ${resolublesConJugador.length} se resolverían ignorando el nombre del jugador (tomar el sin-nombre)`)

  const yaResueltos = conteo.mismo_modelo_distintos_años + conteo.jugadores
  console.log(`\n  ✅ Resolución potencial con fixes adicionales: ${yaResueltos}/${ambiguos.length} (${Math.round(yaResueltos/ambiguos.length*100)}%)`)
}

main().catch(err => { console.error('💥', err); process.exit(1) })
