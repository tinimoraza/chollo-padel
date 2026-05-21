/**
 * scripts/audit-matcher.ts
 * ============================================================
 * Auditoría automática del matcher. Detecta falsos positivos
 * comparando lo que el matcher asigna vs lo que hay en BD,
 * y sugiere fixes concretos al código.
 *
 * Ejecutar:
 *   npx tsx --env-file=.env.local scripts/audit-matcher.ts
 *   npx tsx --env-file=.env.local scripts/audit-matcher.ts --marca Bullpadel
 *   npx tsx --env-file=.env.local scripts/audit-matcher.ts --fix   (solo muestra fixes, no aplica)
 * ============================================================
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const FILTER_MARCA = process.argv.find((_, i, a) => a[i-1] === '--marca') ?? null

// ─── Copia exacta de las constantes del matcher (sincronizar con match-pala-id.ts) ──

const STOP_WORDS = new Set([
  'de', 'da', 'del', 'la', 'el', 'y', 'e', 'con', 'para', 'pala', 'padel',
  'raqueta', 'serie', 'series', 'edition', 'version', 'by',
  'a22', 'a23', 'a24', 'rc',
])

const KEEP_WORDS = new Set([
  'hrd', 'ctrl', 'soft', 'air', 'light', 'team', 'carbon',
  'match', 'drive', 'arrow', 'cross', 'hit', 'rx',
  '18k', '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena', 'hard',
  'pro', 'evo', 'plus', 'motion', 'elite', 'genius', 'attack',
  'lite', 'x', 'proplus', 'woman',
])

const TOKENS_DIFERENCIADORES = new Set([
  'ctrl', 'carbon', 'team', 'hrd', 'light', 'soft', 'air',
  'pro', 'elite', 'attack', 'motion', 'drive', 'match',
  'arrow', 'cross', 'hit', 'rx', 'power', 'speed',
  '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena',
  'hybrid', 'lite', 'x', 'proplus', 'woman',
  'extreme', 'vertex', 'hack', 'genius', 'viper',
  'zephyr', 'delta', 'flash', 'radical', 'instinct', 'prestige',
  'xplore', 'contact', 'xtreme', 'neuron', 'aquila', 'galerna',
  'leader', 'comfort', 'revolution',
  'st1', 'st2', 'st3', 'st4',
  'advance', 'jr',
])

const EXCLUIR_ACCESORIOS = new Set([
  'bolsa', 'mochila', 'funda', 'paletero', 'grip', 'overgrip',
  'protector', 'muñequera', 'bolas', 'pelota', 'pelotas', 'camiseta',
  'zapatilla', 'zapatillas', 'ropa', 'lote', 'antivibrador',
  'raqueta tenis', 'raquetas tenis', 'tenis head', 'tenis wilson',
  'pro staff', 'blade v1', 'blade v9', 'blade v10', 'blade 98', 'blade 100',
  'pure drive', 'pure aero', 'pure strike',
  'hierros', 'madera', 'putter',
  'speedback', 'driver golf', 'esquís', 'esqui', 'snowboard',
  'máquina padel', 'lanzadora', 'slinger',
  'essex', 'pickleball',
  'bolas de golf', 'bolas golf', 'blade pro v',
])

const JUGADORES_PATTERN = /\b(juan lebron|lebron|ale galan|ale gal[aá]n|martita ortega|alex ruiz|agust[ií]n tapia|arturo coello|paquito navarro|coki nieto|stupa|momo gonz[aá]lez)\b/gi

const VERSION_PATTERN = /\b(\d+\.\d+)\b/

// ─── Tokenizador (copia exacta) ───────────────────────────────────────────────

function tokenizar(texto: string): string[] {
  return texto
    .toLowerCase()
    .replace(/hrd\+/g, 'hrd')
    .replace(/\bctr\b/g, 'ctrl')
    .replace(/pro\s*\+/g, 'proplus')
    .replace(/\bpro plus\b/g, 'proplus')
    .replace(/\b(st|electra st)\s+(\d)\b/g, '$1$2')
    .replace(/\bw\b(?=\s|$)/g, 'woman')
    .replace(/\bproline\b/g, 'line')
    .replace(/\btechnivap\b/g, 'technical')
    .replace(/\bhibrid\b/g, 'hybrid')
    .replace(/\b(hack|vertex|flow)\s+(\d)\b/g, '$1 0$2')
    .replace(/\bcontrol\b/g, 'ctrl')
    .replace(/\b(\d+)\.(\d+)\b/g, 'v$1p$2')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 || t === 'x' || /^\d$/.test(t))
    .filter(t =>
      KEEP_WORDS.has(t) ||
      (!STOP_WORDS.has(t) && (!/^\d+$/.test(t) || /^0[1-9]$/.test(t) || /^\d$/.test(t) || /^v\d+p\d+$/.test(t)))
    )
}

function extraerAnio(texto: string): number | null {
  const m = texto.match(/\b(20(1[89]|2[0-9]))\b/)
  return m ? parseInt(m[1]) : null
}

function extraerTokensModelo(modelo: string, marca: string): string[] {
  const sinMarca   = modelo.replace(new RegExp(`^${marca}\\s+`, 'i'), '')
  const sinAnio    = sinMarca.replace(/\b20\d{2}\b/, '').trim()
  const sinJugador = sinAnio.replace(JUGADORES_PATTERN, '').trim()
  return tokenizar(sinJugador)
}

function extraerJugadoresTitulo(titulo: string): string[] {
  const matches: string[] = []
  const re = new RegExp(JUGADORES_PATTERN.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(titulo)) !== null) {
    matches.push(m[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  }
  return matches
}

function extraerVersionModelo(modelo: string): string | null {
  const m = modelo.match(VERSION_PATTERN)
  return m ? m[1] : null
}

function extraerVersionTitulo(titulo: string): string | null {
  const sinAnio = titulo.replace(/\b20\d{2}\b/g, '')
  const m = sinAnio.match(VERSION_PATTERN)
  return m ? m[1] : null
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface PalaCatalogo {
  id:     string
  marca:  string
  modelo: string
  año:    number
  tokens: string[]
}

// ─── Análisis de un título contra el catálogo ────────────────────────────────
// Devuelve qué modelos matchearía el matcher (simplificado pero fiel)

function analizarTitulo(titulo: string, marca: string, candidatas: PalaCatalogo[]): {
  matchea:   PalaCatalogo | null
  razon:     string
  candidatos: { modelo: string; tokens: string[]; ratio: number; difFaltantes: string[] }[]
} {
  const titleLower     = titulo.toLowerCase()
  const tokensTitle    = tokenizar(titleLower)
  const anioTitulo     = extraerAnio(titulo)
  const jugadoresTitulo = extraerJugadoresTitulo(titulo)
  const difEnTitulo    = new Set(tokensTitle.filter(t => TOKENS_DIFERENCIADORES.has(t)))
  const versionTitulo  = extraerVersionTitulo(titulo)

  const PARTIAL_MATCH_THRESHOLD      = 0.6
  const PARTIAL_MATCH_THRESHOLD_SOFT = 0.5
  const PARTIAL_MATCH_THRESHOLD_MIN  = 0.4

  // Fase 1: match estricto
  let scored = candidatas
    .map(pala => {
      if (anioTitulo !== null && pala.año !== anioTitulo) return null
      if (pala.tokens.length === 0) return null
      const tokensMatch = pala.tokens.filter(t => tokensTitle.includes(t))
      if (tokensMatch.length < pala.tokens.length) return null
      const tokensDif = pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t))
      if (!tokensDif.every(t => tokensTitle.includes(t))) return null
      return { pala, score: pala.tokens.length }
    })
    .filter(Boolean) as { pala: PalaCatalogo; score: number }[]

  // Fase 2: match parcial
  if (scored.length === 0) {
    const tieneAnioYJugador = anioTitulo !== null && jugadoresTitulo.length > 0
    const tituloCorto = tokensTitle.length <= 5
    const threshold = tieneAnioYJugador ? PARTIAL_MATCH_THRESHOLD_SOFT
                    : tituloCorto ? PARTIAL_MATCH_THRESHOLD_MIN
                    : PARTIAL_MATCH_THRESHOLD

    const numerosModelo = titleLower
      .replace(/\b20\d{2}\b/g, '')
      .replace(/hrd\+/g, 'hrd')
      .replace(/\b(\d+)\.(\d+)\b/g, 'VER')
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => /^(0[1-9]|v\d+|\d{1,2})$/.test(t) && t !== 'VER')

    const parciales = candidatas
      .map(pala => {
        if (anioTitulo !== null && pala.año !== anioTitulo) return null
        if (pala.tokens.length === 0) return null
        if (numerosModelo.length > 0) {
          const numerosModPala = pala.tokens.filter(t => /^(0[1-9]|v\d+|\d{1,2})$/.test(t) && !/^v\d+p\d+$/.test(t))
          if (numerosModPala.length > 0) {
            if (numerosModPala.every(n => !numerosModelo.includes(n))) return null
          }
        }
        if (numerosModelo.length === 0) {
          const numerosModPala = pala.tokens.filter(t => /^0[1-9]$/.test(t))
          if (numerosModPala.length > 0) return null
        }
        const tokensMatch = pala.tokens.filter(t => tokensTitle.includes(t))
        const ratio = tokensMatch.length / pala.tokens.length
        if (ratio < threshold) return null
        const tokensDif = pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t))
        if (!tokensDif.every(t => tokensTitle.includes(t))) return null
        const difExtra = [...difEnTitulo].filter(d => !pala.tokens.includes(d))
        if (difExtra.length > 0) return null
        return { pala, score: tokensMatch.length }
      })
      .filter(Boolean) as { pala: PalaCatalogo; score: number }[]

    if (parciales.length > 0) {
      // Filtrar jugadores si el título no los menciona
      let filtrados = parciales
      if (jugadoresTitulo.length === 0) {
        const RE_JUG2 = new RegExp(JUGADORES_PATTERN.source, 'gi')
        const sinJug = parciales.filter(s =>
          !RE_JUG2.test(s.pala.modelo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
        )
        if (sinJug.length > 0) filtrados = sinJug
      }
      filtrados.sort((a, b) => b.score - a.score)
      const maxScore = filtrados[0].score
      const top = filtrados.filter(s => s.score === maxScore)
      if (top.length === 1) scored = top
      else {
        const maxAnio = Math.max(...top.map(s => s.pala.año))
        const topAnio = top.filter(s => s.pala.año === maxAnio)
        if (topAnio.length === 1) scored = topAnio
      }
    }
  }

  // Desempate jugadores (fase estricta)
  if (scored.length > 1) {
    if (jugadoresTitulo.length > 0) {
      const conJug = scored.filter(s =>
        jugadoresTitulo.some(j => s.pala.modelo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(j))
      )
      if (conJug.length > 0 && conJug.length < scored.length) scored = conJug
    } else {
      const RE_JUG2 = new RegExp(JUGADORES_PATTERN.source, 'gi')
      const sinJug = scored.filter(s =>
        !RE_JUG2.test(s.pala.modelo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
      )
      if (sinJug.length > 0) scored = sinJug
    }
  }

  // Desempate versión
  if (scored.length > 1 && versionTitulo !== null) {
    const conVer = scored.filter(s => extraerVersionModelo(s.pala.modelo) === versionTitulo)
    if (conVer.length > 0) scored = conVer
  }

  // Desempate especificidad
  if (scored.length > 1) {
    scored.sort((a, b) => b.score - a.score)
    const maxScore = scored[0].score
    const top = scored.filter(s => s.score === maxScore)
    const minExtra = Math.min(...top.map(s => s.pala.tokens.filter(t => !tokensTitle.includes(t)).length))
    const topSin = top.filter(s => s.pala.tokens.filter(t => !tokensTitle.includes(t)).length === minExtra)
    if (topSin.length === 1) scored = topSin
    else {
      const maxAnio = Math.max(...topSin.map(s => s.pala.año))
      const topAnio = topSin.filter(s => s.pala.año === maxAnio)
      if (topAnio.length === 1) scored = topAnio
    }
  }

  // Info diagnóstico de todos los candidatos
  const infoCandidatos = candidatas.slice(0, 20).map(pala => {
    const tokensMatch = pala.tokens.filter(t => tokensTitle.includes(t))
    const ratio = pala.tokens.length > 0 ? tokensMatch.length / pala.tokens.length : 0
    const difFaltantes = pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t) && !tokensTitle.includes(t))
    return { modelo: pala.modelo, tokens: pala.tokens, ratio, difFaltantes }
  }).sort((a, b) => b.ratio - a.ratio)

  if (scored.length === 1) {
    return { matchea: scored[0].pala, razon: 'match único', candidatos: infoCandidatos }
  }
  if (scored.length > 1) {
    return { matchea: null, razon: `ambiguo (${scored.length} candidatos)`, candidatos: infoCandidatos }
  }
  return { matchea: null, razon: 'sin match', candidatos: infoCandidatos }
}

// ─── Detección de FP: el matcher asigna un pala_id pero BD tiene otro ────────

interface FalsoPositivo {
  titulo:        string
  marca:         string
  pala_id_bd:    string
  modelo_bd:     string
  pala_id_match: string
  modelo_match:  string
  tokens_titulo: string[]
  tokens_modelo_bd:    string[]
  tokens_modelo_match: string[]
  dif_faltantes: string[]   // tokens diferenciadores del modelo BD que no están en el título
  sugerencia:    string
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 HUNTPADEL — Auditoría automática de falsos positivos')
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  // 1. Cargar catálogo completo
  console.log('📚 Cargando catálogo...')
  const palasRaw: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase.from('palas').select('id, marca, modelo, año').range(from, from + 999)
    if (error) { console.error('❌', error); process.exit(1) }
    if (!data?.length) break
    palasRaw.push(...data)
    if (data.length < 1000) break
    from += 1000
  }

  const palas: PalaCatalogo[] = palasRaw.map(p => ({
    id: p.id, marca: p.marca, modelo: p.modelo, año: p.año,
    tokens: extraerTokensModelo(p.modelo, p.marca),
  }))

  const palaById = new Map(palas.map(p => [p.id, p]))
  const palasPorMarca = new Map<string, PalaCatalogo[]>()
  for (const p of palas) {
    const m = p.marca.toLowerCase()
    if (!palasPorMarca.has(m)) palasPorMarca.set(m, [])
    palasPorMarca.get(m)!.push(p)
  }
  console.log(`  ${palas.length} palas, ${palasPorMarca.size} marcas\n`)

  // 2. Cargar anuncios YA matchados en BD (ground truth) — muestra grande
  console.log('📦 Cargando anuncios matchados en BD...')
  let query = supabase
    .from('wallapop_cache')
    .select('external_id, title, marca, pala_id')
    .not('pala_id', 'is', null)
    .limit(3000)

  if (FILTER_MARCA) query = query.eq('marca', FILTER_MARCA)

  const { data: matchados, error: errM } = await query
  if (errM) { console.error('❌', errM); process.exit(1) }
  console.log(`  ${matchados?.length ?? 0} anuncios matchados\n`)

  // 3. Para cada anuncio, re-ejecutar el matcher y comparar
  const falsosPosotivos: FalsoPositivo[] = []
  const correctos: number[] = []
  const sinModelo: number[] = []

  for (const item of (matchados ?? [])) {
    const modeloBD = palaById.get(item.pala_id)
    if (!modeloBD) continue

    const marcaNorm = (item.marca ?? '').toLowerCase()
    const candidatas = palasPorMarca.get(marcaNorm) ?? []
    if (candidatas.length === 0) continue

    // Saltar accesorios
    const tl = item.title.toLowerCase()
    if ([...EXCLUIR_ACCESORIOS].some(w => tl.includes(w))) continue

    const { matchea } = analizarTitulo(item.title, marcaNorm, candidatas)

    if (!matchea) {
      sinModelo.push(1)
      continue
    }

    if (matchea.id === item.pala_id) {
      correctos.push(1)
      continue
    }

    // FP detectado: el matcher asignaría otro modelo distinto al de BD
    const tokensTitulo   = tokenizar(tl)
    const tokensModeloBD = modeloBD.tokens
    const difFaltantes   = tokensModeloBD.filter(t => TOKENS_DIFERENCIADORES.has(t) && !tokensTitulo.includes(t))

    // Generar sugerencia automática
    let sugerencia = ''
    if (difFaltantes.length > 0) {
      sugerencia = `Añadir a TOKENS_DIFERENCIADORES: ${difFaltantes.map(t => `'${t}'`).join(', ')}`
    } else {
      // Ver si el título tiene diferenciadores que apuntan al modelo incorrecto
      const difExtra = tokensTitulo.filter(t => TOKENS_DIFERENCIADORES.has(t) && !tokensModeloBD.includes(t))
      if (difExtra.length > 0) {
        sugerencia = `El título tiene diferenciadores del modelo erróneo: [${difExtra.join(', ')}]. Revisar si falta inyección de tokens o normalización.`
      } else {
        sugerencia = `Ambigüedad por ratio — revisar si el modelo BD necesita más tokens diferenciadores en el catálogo.`
      }
    }

    falsosPosotivos.push({
      titulo:        item.title,
      marca:         item.marca ?? '',
      pala_id_bd:    item.pala_id,
      modelo_bd:     modeloBD.modelo,
      pala_id_match: matchea.id,
      modelo_match:  matchea.modelo,
      tokens_titulo: tokensTitulo,
      tokens_modelo_bd:    tokensModeloBD,
      tokens_modelo_match: matchea.tokens,
      dif_faltantes: difFaltantes,
      sugerencia,
    })
  }

  // 4. Resultados
  const total = correctos.length + falsosPosotivos.length + sinModelo.length
  console.log('═══════════════════════════════════════════════════════════')
  console.log('📊 RESUMEN AUDITORÍA')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`  ✅ Correctos:        ${correctos.length} / ${total} (${(correctos.length/total*100).toFixed(1)}%)`)
  console.log(`  ❌ Falsos positivos: ${falsosPosotivos.length} / ${total} (${(falsosPosotivos.length/total*100).toFixed(1)}%)`)
  console.log(`  ⚪ Sin re-match:     ${sinModelo.length} / ${total}`)
  console.log()

  if (falsosPosotivos.length === 0) {
    console.log('🎉 No se detectaron falsos positivos. El matcher está limpio.')
    return
  }

  // 5. Agrupar FPs por sugerencia para priorizar fixes
  const fixMap = new Map<string, FalsoPositivo[]>()
  for (const fp of falsosPosotivos) {
    if (!fixMap.has(fp.sugerencia)) fixMap.set(fp.sugerencia, [])
    fixMap.get(fp.sugerencia)!.push(fp)
  }

  const fixesSorted = [...fixMap.entries()].sort((a, b) => b[1].length - a[1].length)

  console.log('═══════════════════════════════════════════════════════════')
  console.log(`🔧 FIXES SUGERIDOS (${fixesSorted.length} distintos, ordenados por impacto)`)
  console.log('═══════════════════════════════════════════════════════════\n')

  for (const [sugerencia, fps] of fixesSorted) {
    console.log(`━━━ [${fps.length} caso${fps.length > 1 ? 's' : ''}] ${sugerencia}`)
    for (const fp of fps.slice(0, 5)) {
      console.log(`  título:  "${fp.titulo.substring(0, 70)}"`)
      console.log(`  BD:      ${fp.modelo_bd}`)
      console.log(`  matcher: ${fp.modelo_match}`)
      console.log(`  tokens título: [${fp.tokens_titulo.join(', ')}]`)
      console.log(`  tokens BD:     [${fp.tokens_modelo_bd.join(', ')}]`)
      if (fp.dif_faltantes.length > 0) {
        console.log(`  ⚠️  diferenciadores faltantes en título: [${fp.dif_faltantes.join(', ')}]`)
      }
      console.log()
    }
    if (fps.length > 5) console.log(`  ... y ${fps.length - 5} más\n`)
  }

  // 6. Resumen de tokens diferenciadores más frecuentes como candidatos a añadir
  const candidatosDif = new Map<string, number>()
  for (const fp of falsosPosotivos) {
    for (const t of fp.dif_faltantes) {
      candidatosDif.set(t, (candidatosDif.get(t) ?? 0) + 1)
    }
  }

  if (candidatosDif.size > 0) {
    const sorted = [...candidatosDif.entries()].sort((a, b) => b[1] - a[1])
    console.log('═══════════════════════════════════════════════════════════')
    console.log('🎯 TOKENS CANDIDATOS A AÑADIR EN TOKENS_DIFERENCIADORES')
    console.log('═══════════════════════════════════════════════════════════')
    for (const [token, count] of sorted) {
      console.log(`  '${token}'  →  ${count} FP que resolvería`)
    }
    console.log()
    console.log('Pegar en match-pala-id.ts → const TOKENS_DIFERENCIADORES:')
    console.log(sorted.map(([t]) => `  '${t}',`).join('\n'))
    console.log()
  }
}

main().catch(err => {
  console.error('💥', err)
  process.exit(1)
})
