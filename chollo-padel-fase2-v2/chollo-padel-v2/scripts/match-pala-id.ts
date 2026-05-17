/**
 * scripts/match-pala-id.ts
 * ===========================================
 * Cruza los anuncios de wallapop_cache (pala_id = null) contra
 * la tabla palas del catálogo e intenta asignar el pala_id correcto.
 *
 * Estrategia de matching:
 *  1. Filtra candidatos por marca (campo marca en wallapop_cache)
 *  2. Extrae tokens del modelo del catálogo (sin marca ni año)
 *  3. Comprueba que TODOS los tokens aparecen en el título del anuncio
 *  4. Si hay año en el título, debe coincidir con el año del catálogo
 *  5. Si hay un único match → asigna pala_id
 *     Si hay varios matches → elige el de más tokens (más específico)
 *     Si hay empate → no asigna (ambiguo)
 *
 * Ejecutar:
 *   npx tsx --env-file=.env.local scripts/match-pala-id.ts
 *   npx tsx --env-file=.env.local scripts/match-pala-id.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const DRY_RUN = process.argv.includes('--dry-run')

// Palabras a ignorar al tokenizar el modelo (artículos, preposiciones, etc.)
const STOP_WORDS = new Set([
  'de', 'da', 'del', 'la', 'el', 'y', 'e', 'con', 'para', 'pala', 'padel',
  'raqueta', 'serie', 'series', 'edition', 'version', 'by',
])

// Palabras que diferencian modelos — nunca ignorar aunque sean cortas
const KEEP_WORDS = new Set([
  'hrd', 'hrd+', 'ctrl', 'soft', 'air', 'light', 'team', 'carbon',
  'match', 'drive', 'arrow', 'cross', 'hit', 'rx',
  '18k', '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena', 'hard',
  'pro', 'evo', 'plus', 'motion', 'elite', 'genius', 'attack',
])

// Sufijos de generación que NO aportan al matching (numeraciones de versión Adidas/Babolat)
// OJO: NO incluir 18k/12k porque son parte del nombre del modelo en Nox
const VERSION_SUFFIXES = /\b(3\.4|3\.0|2\.6|2\.0|1\.0)\b/gi

function tokenizar(texto: string): string[] {
  return texto
    .toLowerCase()
    .replace(/hrd\+/g, 'hrd')    // normalizar hrd+ → hrd
    .replace(/ctr/g, 'ctrl') // normalizar ctr → ctrl (Bullpadel usa CTR, otros CTRL)
    .replace(/[^\w\s]/g, ' ')    // quitar toda puntuación
    .split(/\s+/)
    .filter(t => t.length >= 2)
    .filter(t => KEEP_WORDS.has(t) || (!STOP_WORDS.has(t) && (!/^\d+$/.test(t) || /^0[1-9]$/.test(t))))  // preservar 01-09 (versiones modelo Bullpadel)
}

function extraerAnio(texto: string): number | null {
  const m = texto.match(/\b(20(1[89]|2[0-9]))\b/)
  return m ? parseInt(m[1]) : null
}

function extraerTokensModelo(modelo: string, marca: string): string[] {
  // Quitar la marca del inicio
  const sinMarca = modelo.replace(new RegExp(`^${marca}\\s+`, 'i'), '')
  // Quitar el año
  const sinAnio  = sinMarca.replace(/\b20\d{2}\b/, '').trim()
  // Quitar sufijos de jugador conocidos (Juan Lebron, Ale Galan, Martita Ortega, Alex Ruiz...)
  const sinJugador = sinAnio.replace(/\b(juan lebron|ale galan|ale galán|martita ortega|alex ruiz|agustin tapia|agustín tapia)\b/gi, '').trim()
  const sinVersion = sinJugador.replace(VERSION_SUFFIXES, '').trim()
  return tokenizar(sinVersion)
}

interface PalaCatalogo {
  id:     string
  marca:  string
  modelo: string
  año:    number
  tokens: string[]
}

interface CacheItem {
  external_id: string
  title:       string
  marca:       string | null
}

/**
 * Función exportable para usar desde otros scripts (scrapers).
 * Recibe el cliente supabase ya inicializado para reutilizarlo.
 */
export async function matchPalaIds(supabase: ReturnType<typeof createClient>, opts?: { verbose?: boolean }): Promise<{ matched: number; ambiguous: number; noMatch: number }> {
  const verbose = opts?.verbose ?? true

  if (verbose) console.log('\n🔗 Match pala_id iniciado...')

  const { data: palasRaw, error: palasErr } = await supabase
    .from('palas')
    .select('id, marca, modelo, año')

  if (palasErr || !palasRaw) {
    console.error('❌ matchPalaIds: Error cargando palas:', palasErr)
    return { matched: 0, ambiguous: 0, noMatch: 0 }
  }

  const palas: PalaCatalogo[] = palasRaw.map((p: any) => ({
    id:     p.id,
    marca:  p.marca,
    modelo: p.modelo,
    año:    p.año,
    tokens: extraerTokensModelo(p.modelo, p.marca),
  }))

  const palasPorMarca = new Map<string, PalaCatalogo[]>()
  for (const pala of palas) {
    const m = pala.marca.toLowerCase()
    if (!palasPorMarca.has(m)) palasPorMarca.set(m, [])
    palasPorMarca.get(m)!.push(pala)
  }

  const { data: items, error: itemsErr } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, marca')
    .is('pala_id', null)
    .not('marca', 'is', null)

  if (itemsErr || !items) {
    console.error('❌ matchPalaIds: Error cargando cache:', itemsErr)
    return { matched: 0, ambiguous: 0, noMatch: 0 }
  }

  const EXCLUIR_ACCESORIOS = ['bolsa','mochila','funda','paletero','grip','overgrip',
    'protector','muñequera','bolas','pelota','pelotas','camiseta','zapatilla','zapatillas',
    'ropa','lote','pack','antivibrador']

  const TOKENS_DIFERENCIADORES = new Set([
    'ctrl','carbon','team','hrd','light','soft','air',
    'pro','elite','attack','motion','drive','match',
    'arrow','cross','hit','rx','hybrid','power','speed',
    '18k','12k','alum','luxury','ltd','xtrem','arena',
  ])

  let matched = 0, ambiguous = 0, noMatch = 0
  const updates: { external_id: string; pala_id: string }[] = []

  for (const item of items as CacheItem[]) {
    const marcaAnuncio = item.marca?.toLowerCase()
    if (!marcaAnuncio) continue
    const candidatas = palasPorMarca.get(marcaAnuncio) ?? []
    if (candidatas.length === 0) continue

    const titleLower = item.title.toLowerCase()
    if (EXCLUIR_ACCESORIOS.some(w => titleLower.includes(w))) { noMatch++; continue }

    const anioTitulo = extraerAnio(item.title)
    const tokensTitle = tokenizar(titleLower)

    const scored = candidatas
      .map(pala => {
        if (anioTitulo !== null && pala.año !== anioTitulo) return null
        const tokensMatch = pala.tokens.filter(t => tokensTitle.includes(t))
        if (tokensMatch.length < pala.tokens.length) return null
        if (tokensMatch.length === 0) return null
        const tokensDif = pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t))
        if (!tokensDif.every(t => tokensTitle.includes(t))) return null
        return { pala, score: pala.tokens.length }
      })
      .filter(Boolean) as { pala: PalaCatalogo; score: number }[]

    if (scored.length === 0) { noMatch++; continue }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const extraA = a.pala.tokens.filter(t => !tokensTitle.includes(t)).length
      const extraB = b.pala.tokens.filter(t => !tokensTitle.includes(t)).length
      return extraA - extraB
    })

    const maxScore = scored[0].score
    const topMatches = scored.filter(s => s.score === maxScore)
    const topSinExtra = topMatches.filter(s =>
      s.pala.tokens.filter(t => !tokensTitle.includes(t)).length ===
      topMatches[0].pala.tokens.filter(t => !tokensTitle.includes(t)).length
    )

    if (topSinExtra.length > 1) { ambiguous++; continue }

    matched++
    updates.push({ external_id: item.external_id, pala_id: topSinExtra[0].pala.id })
  }

  if (updates.length > 0) {
    const BATCH = 100
    for (let i = 0; i < updates.length; i += BATCH) {
      for (const u of updates.slice(i, i + BATCH)) {
        await supabase.from('wallapop_cache').update({ pala_id: u.pala_id }).eq('external_id', u.external_id)
      }
    }
  }

  if (verbose) {
    console.log(`  ✅ Match pala_id: ${matched} asignados, ${ambiguous} ambiguos, ${noMatch} sin match`)
  }

  return { matched, ambiguous, noMatch }
}

async function main() {
  console.log(`🔗 HUNTPADEL — Match pala_id${DRY_RUN ? ' [DRY RUN]' : ''}`)
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  // ── 1. Cargar catálogo de palas ───────────────────────────────────────────
  console.log('📚 Cargando catálogo de palas...')
  const { data: palasRaw, error: palasErr } = await supabase
    .from('palas')
    .select('id, marca, modelo, año')

  if (palasErr || !palasRaw) {
    console.error('❌ Error cargando palas:', palasErr)
    process.exit(1)
  }

  const palas: PalaCatalogo[] = palasRaw.map(p => ({
    id:     p.id,
    marca:  p.marca,
    modelo: p.modelo,
    año:    p.año,
    tokens: extraerTokensModelo(p.modelo, p.marca),
  }))

  // Agrupar por marca para búsqueda rápida
  const palasPorMarca = new Map<string, PalaCatalogo[]>()
  for (const pala of palas) {
    const m = pala.marca.toLowerCase()
    if (!palasPorMarca.has(m)) palasPorMarca.set(m, [])
    palasPorMarca.get(m)!.push(pala)
  }

  console.log(`  ${palas.length} palas cargadas, ${palasPorMarca.size} marcas\n`)

  // Debug: mostrar tokens de algunas palas conocidas
  const ejemplos = ['Babolat Technical Viper', 'Adidas Metalbone HRD', 'Nox AT10']
  for (const ej of ejemplos) {
    const pala = palas.find(p => p.modelo.includes(ej))
    if (pala) console.log(`  Tokens "${pala.modelo}": [${pala.tokens.join(', ')}]`)
  }
  console.log()

  // ── 2. Cargar anuncios sin pala_id ────────────────────────────────────────
  console.log('📦 Cargando wallapop_cache sin pala_id...')
  const { data: items, error: itemsErr } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, marca')
    .is('pala_id', null)
    .not('marca', 'is', null)

  if (itemsErr || !items) {
    console.error('❌ Error cargando wallapop_cache:', itemsErr)
    process.exit(1)
  }

  console.log(`  ${items.length} anuncios sin pala_id\n`)

  // Palabras que indican que el anuncio NO es una pala
  const EXCLUIR_ACCESORIOS = ['bolsa', 'mochila', 'funda', 'paletero', 'grip', 'overgrip',
    'protector', 'muñequera', 'bolas', 'pelota', 'pelotas', 'camiseta', 'zapatilla', 'zapatillas',
    'ropa', 'lote', 'pack', 'antivibrador']

  // ── 3. Intentar matchear cada anuncio ────────────────────────────────────
  let matched    = 0
  let ambiguous  = 0
  let noMatch    = 0
  const updates: { external_id: string; pala_id: string; titulo: string; modelo: string }[] = []

  for (const item of items as CacheItem[]) {
    const marcaAnuncio = item.marca?.toLowerCase()
    if (!marcaAnuncio) continue

    const candidatas = palasPorMarca.get(marcaAnuncio) ?? []
    if (candidatas.length === 0) continue

    const titleLower = item.title.toLowerCase()

    // Saltar accesorios
    if (EXCLUIR_ACCESORIOS.some(w => titleLower.includes(w))) { noMatch++; continue }

    const anioTitulo = extraerAnio(item.title)
    const tokensTitle = tokenizar(titleLower)

    // Tokens diferenciadores presentes en el título
    // Si un modelo requiere un token diferenciador que NO está en el título → descartarlo
    const TOKENS_DIFERENCIADORES = new Set([
      'ctrl', 'carbon', 'team', 'hrd', 'light', 'soft', 'air',
      'pro', 'elite', 'attack', 'motion', 'drive', 'match',
      'arrow', 'cross', 'hit', 'rx', 'hybrid', 'power', 'speed',
      '18k', '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena',
    ])

    // Puntuar cada pala candidata
    const scored = candidatas
      .map(pala => {
        // Si el título tiene año, debe coincidir
        if (anioTitulo !== null && pala.año !== anioTitulo) return null

        // Todos los tokens del modelo deben estar en el título
        const tokensMatch = pala.tokens.filter(t => tokensTitle.includes(t))
        if (tokensMatch.length < pala.tokens.length) return null
        if (tokensMatch.length === 0) return null

        // CLAVE: si el modelo tiene tokens diferenciadores que NO están en el título → descartar
        // Ej: modelo requiere "ctrl" pero el título no tiene "ctrl" → no es ese modelo
        const tokensDiferenciadores = pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t))
        const tituloTieneDiferenciador = tokensDiferenciadores.every(t => tokensTitle.includes(t))
        if (!tituloTieneDiferenciador) return null

        return { pala, score: pala.tokens.length } // más tokens = más específico
      })
      .filter(Boolean) as { pala: PalaCatalogo; score: number }[]

    if (scored.length === 0) {
      noMatch++
      continue
    }

    // Ordenar por especificidad: más tokens = más específico
    // Desempate: menor diferencia entre tokens del modelo y tokens del título (match más ajustado)
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      // Desempate: preferir el modelo cuyos tokens están todos en el título sin "ruido"
      const extraA = a.pala.tokens.filter(t => !tokensTitle.includes(t)).length
      const extraB = b.pala.tokens.filter(t => !tokensTitle.includes(t)).length
      return extraA - extraB
    })
    const maxScore = scored[0].score

    // Comprobar si hay empate irresoluble en el top
    const topMatches = scored.filter(s => s.score === maxScore)
    const topSinExtra = topMatches.filter(s =>
      s.pala.tokens.filter(t => !tokensTitle.includes(t)).length ===
      topMatches[0].pala.tokens.filter(t => !tokensTitle.includes(t)).length
    )

    if (topSinExtra.length > 1) {
      // Ambiguo: varios modelos igual de específicos — no asignar
      ambiguous++
      continue
    }

    const winner = topMatches[0].pala
    matched++
    updates.push({
      external_id: item.external_id,
      pala_id:     winner.id,
      titulo:      item.title,
      modelo:      winner.modelo,
    })
  }

  console.log(`📊 Resultados del matching:`)
  console.log(`  ✅ Matches claros:  ${matched}`)
  console.log(`  ⚠️  Ambiguos:       ${ambiguous}`)
  console.log(`  ❌ Sin match:       ${noMatch}\n`)

  if (updates.length === 0) {
    console.log('⚠️  Sin actualizaciones que aplicar.')
    return
  }

  // Mostrar muestra de matches
  console.log('📋 Muestra de matches (primeros 20):')
  for (const u of updates.slice(0, 20)) {
    console.log(`  "${u.titulo.substring(0, 50)}"`)
    console.log(`    → ${u.modelo}\n`)
  }

  if (DRY_RUN) {
    console.log(`🔍 DRY RUN — se aplicarían ${updates.length} actualizaciones. Ejecuta sin --dry-run para aplicar.`)
    return
  }

  // ── 4. Aplicar actualizaciones en batches ────────────────────────────────
  console.log(`💾 Aplicando ${updates.length} actualizaciones...`)
  const BATCH = 100
  let ok = 0

  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH)

    for (const u of batch) {
      const { error } = await supabase
        .from('wallapop_cache')
        .update({ pala_id: u.pala_id })
        .eq('external_id', u.external_id)

      if (error) {
        console.error(`  ⚠️  Error actualizando ${u.external_id}:`, error.message)
      } else {
        ok++
      }
    }

    console.log(`  ${Math.min(i + BATCH, updates.length)}/${updates.length}...`)
  }

  console.log(`\n✅ ${ok} anuncios actualizados con pala_id.`)
  console.log('🏁 Match pala_id completado.\n')
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
