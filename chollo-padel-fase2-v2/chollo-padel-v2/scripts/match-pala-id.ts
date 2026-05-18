/**
 * scripts/match-pala-id.ts
 * ===========================================
 * Cruza los anuncios de wallapop_cache (pala_id = null) contra
 * la tabla palas del catálogo e intenta asignar el pala_id correcto.
 *
 * Estrategia de matching:
 *  1. Filtra candidatos por marca (campo marca en wallapop_cache, o detectada del título)
 *  2. Extrae tokens del modelo del catálogo (sin marca ni año)
 *  3. Comprueba que TODOS los tokens aparecen en el título del anuncio
 *  4. Si el título contiene un token diferenciador (hrd, team, ctrl…) y hay candidatos
 *     que NO lo requieren compitiendo con los que SÍ → descarta los que no lo requieren
 *  5. Si hay año en el título, debe coincidir con el año del catálogo
 *  6. Si hay un único match → asigna pala_id
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

// ─── Constantes compartidas (una única fuente de verdad) ──────────────────────

// Palabras a ignorar al tokenizar el modelo (artículos, preposiciones, etc.)
const STOP_WORDS = new Set([
  'de', 'da', 'del', 'la', 'el', 'y', 'e', 'con', 'para', 'pala', 'padel',
  'raqueta', 'serie', 'series', 'edition', 'version', 'by',
])

// Palabras que diferencian modelos — nunca ignorar aunque sean cortas
const KEEP_WORDS = new Set([
  'hrd', 'ctrl', 'soft', 'air', 'light', 'team', 'carbon',
  'match', 'drive', 'arrow', 'cross', 'hit', 'rx',
  '18k', '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena', 'hard',
  'pro', 'evo', 'plus', 'motion', 'elite', 'genius', 'attack',
  'lite',    // Nox AT10 Xtreme Lite
  'x',       // Head Speed Pro X vs Speed Pro
  'proplus', // Oxdog Ultimate Pro+ vs Pro
])

// Tokens que diferencian variantes dentro de una misma familia.
// Si el TÍTULO los contiene, los modelos que no los requieren son descartados.
// CLAVE: usar los tokens YA normalizados (hrd, no hrd+) igual que tokenizar().
const TOKENS_DIFERENCIADORES = new Set([
  'ctrl', 'carbon', 'team', 'hrd', 'light', 'soft', 'air',
  'pro', 'elite', 'attack', 'motion', 'drive', 'match',
  'arrow', 'cross', 'hit', 'rx', 'hybrid', 'power', 'speed',
  '18k', '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena',
  'lite',    // Nox AT10 Xtreme Lite vs Xtreme
  'x',       // Head Speed Pro X vs Speed Pro
  'proplus', // Oxdog Ultimate Pro+ vs Pro
])

// Palabras que indican que el anuncio NO es una pala
const EXCLUIR_ACCESORIOS = new Set([
  // Accesorios pádel
  'bolsa', 'mochila', 'funda', 'paletero', 'grip', 'overgrip',
  'protector', 'muñequera', 'bolas', 'pelota', 'pelotas', 'camiseta',
  'zapatilla', 'zapatillas', 'ropa', 'lote', 'antivibrador',
  // Raquetas de tenis inequívocas (no confundibles con pádel)
  'raqueta tenis', 'raquetas tenis', 'tenis head', 'tenis wilson',
  'pro staff', 'blade v1', 'blade v9', 'blade v10', 'blade 98', 'blade 100',
  'pure drive', 'pure aero', 'pure strike',
  'hierros', 'madera', 'putter',
  // Golf / esquí / otros deportes
  'speedback', 'driver golf', 'esquís', 'esqui', 'snowboard',
  // Máquinas y equipamiento
  'máquina padel', 'lanzadora',
])

// Versiones de generación estilo "3.4", "2.0", "1.5" — se extraen del modelo
// para usarlas como token de desempate. NO se eliminan del modelo.
// La regex captura el número X.Y tal como aparece en el modelo del catálogo.
const VERSION_PATTERN = /\b(\d+\.\d+)\b/

// Marcas conocidas para detección desde título cuando marca=null
const MARCAS_CONOCIDAS: Record<string, string> = {
  'bullpadel':  'Bullpadel',
  'nox':        'Nox',
  'head':       'Head',
  'adidas':     'Adidas',
  'babolat':    'Babolat',
  'wilson':     'Wilson',
  'dunlop':     'Dunlop',
  'starvie':    'StarVie',
  'star vie':   'StarVie',
  'vibora':     'Vibora',
  'víbora':     'Vibora',
  'siux':       'Siux',
  'royal padel':'Royal Padel',
  'royal':      'Royal Padel',
  'drop shot':  'Drop Shot',
  'dropshot':   'Drop Shot',
  'tecnifibre': 'Tecnifibre',
  'black crown':'Black Crown',
  'blackcrown': 'Black Crown',
  'varlion':    'Varlion',
  'volt':       'Volt',
  'tamanaco':   'Tamanaco',
}

// ─── Funciones de parsing ──────────────────────────────────────────────────────

function tokenizar(texto: string): string[] {
  return texto
    .toLowerCase()
    .replace(/hrd\+/g, 'hrd')          // normalizar hrd+ → hrd
    .replace(/\bctr\b/g, 'ctrl')       // normalizar ctr → ctrl (Bullpadel usa CTR)
    .replace(/pro\s*\+/g, 'proplus')   // normalizar "pro +" / "pro+" → proplus (Oxdog)
    .replace(/\bpro plus\b/g, 'proplus') // normalizar "pro plus" → proplus
    .replace(/[^\w\s]/g, ' ')          // quitar toda puntuación
    .split(/\s+/)
    .filter(t => t.length >= 2 || t === 'x')  // preservar 'x' aunque sea 1 char
    .filter(t =>
      KEEP_WORDS.has(t) ||
      (!STOP_WORDS.has(t) && (!/^\d+$/.test(t) || /^0[1-9]$/.test(t)))
    )  // preservar 01-09 (versiones modelo Bullpadel)
}

function extraerAnio(texto: string): number | null {
  const m = texto.match(/\b(20(1[89]|2[0-9]))\b/)
  return m ? parseInt(m[1]) : null
}

// Jugadores conocidos — se eliminan del modelo del catálogo para tokenizar,
// pero se usan como tokens de desempate cuando aparecen en el título del anuncio.
const JUGADORES_PATTERN = /\b(juan lebron|ale galan|ale gal[aá]n|martita ortega|alex ruiz|agust[ií]n tapia|arturo coello|paquito navarro|coki nieto|stupa|momo gonz[aá]lez)\b/gi

function extraerTokensModelo(modelo: string, marca: string): string[] {
  const sinMarca   = modelo.replace(new RegExp(`^${marca}\\s+`, 'i'), '')
  const sinAnio    = sinMarca.replace(/\b20\d{2}\b/, '').trim()
  const sinJugador = sinAnio.replace(JUGADORES_PATTERN, '').trim()
  return tokenizar(sinJugador)
}

/** Extrae los tokens de jugador del título (para desempate). */
function extraerJugadoresTitulo(titulo: string): string[] {
  const matches: string[] = []
  const re = new RegExp(JUGADORES_PATTERN.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(titulo)) !== null) {
    // Normalizar sin tildes, minúsculas — pero CONSERVAR espacios internos
    // para que coincida con el nombre del modelo ("juan lebron", no "juanlebron")
    matches.push(m[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  }
  return matches
}

/** Extrae el número de versión X.Y de un modelo del catálogo, si lo tiene. Ej: "3.4" de "Metalbone 3.4 HRD+". */
function extraerVersionModelo(modelo: string): string | null {
  const m = modelo.match(VERSION_PATTERN)
  return m ? m[1] : null
}

/** Extrae el número de versión X.Y de un título de anuncio, si lo tiene. */
function extraerVersionTitulo(titulo: string): string | null {
  // Ignorar años (20XX) antes de buscar versiones
  const sinAnio = titulo.replace(/\b20\d{2}\b/g, '')
  const m = sinAnio.match(VERSION_PATTERN)
  return m ? m[1] : null
}

/** Intenta detectar la marca desde el título cuando wallapop_cache.marca es null. */
function detectarMarcaDesideTitulo(titulo: string): string | null {
  const tl = titulo.toLowerCase()
  // Primero intentar frases de dos palabras (ej: "drop shot", "black crown")
  for (const [key, val] of Object.entries(MARCAS_CONOCIDAS)) {
    if (key.includes(' ') && tl.includes(key)) return val
  }
  // Luego palabras sueltas
  for (const [key, val] of Object.entries(MARCAS_CONOCIDAS)) {
    if (!key.includes(' ') && tl.split(/\s+/).includes(key)) return val
  }
  return null
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

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

// ─── Lógica central de matching (reutilizada por main y matchPalaIds) ─────────

interface MatchResult {
  external_id: string
  pala_id:     string
  titulo:      string
  modelo:      string
}

// Umbral de match parcial: % mínimo de tokens del modelo que deben estar en el título
// Lo suficientemente alto para evitar falsos positivos, lo suficiente bajo para cubrir
// anuncios con nombre corto ("Nox AT10 Genius" → modelo "Nox AT10 Genius Attack 18K Alum")
const PARTIAL_MATCH_THRESHOLD = 0.6

function matchearItem(
  item: CacheItem,
  palasPorMarca: Map<string, PalaCatalogo[]>
): MatchResult | 'noMatch' | 'ambiguous' | 'excluido' {
  const titleLower = item.title.toLowerCase()

  // Descartar accesorios
  if ([...EXCLUIR_ACCESORIOS].some(w => titleLower.includes(w))) return 'excluido'

  // Resolver marca: desde wallapop_cache.marca o detectar del título
  let marcaNorm = item.marca?.toLowerCase() ?? null
  if (!marcaNorm) {
    const detectada = detectarMarcaDesideTitulo(item.title)
    if (detectada) marcaNorm = detectada.toLowerCase()
  }
  if (!marcaNorm) return 'noMatch'

  // Normalizar variantes ("starvie" puede venir como "star vie" o "StarVie")
  if (marcaNorm === 'star vie') marcaNorm = 'starvie'

  const candidatas = palasPorMarca.get(marcaNorm) ?? []
  if (candidatas.length === 0) return 'noMatch'

  const anioTitulo    = extraerAnio(item.title)
  const versionTitulo = extraerVersionTitulo(item.title)
  const tokensTitle   = tokenizar(titleLower)
  const difEnTitulo   = new Set(tokensTitle.filter(t => TOKENS_DIFERENCIADORES.has(t)))
  const jugadoresTitulo = extraerJugadoresTitulo(item.title)

  // ── Fase 1: match ESTRICTO (todos los tokens del modelo en el título) ──────
  let scored = candidatas
    .map(pala => {
      if (anioTitulo !== null && pala.año !== anioTitulo) return null
      if (pala.tokens.length === 0) return null
      const tokensMatch = pala.tokens.filter(t => tokensTitle.includes(t))
      if (tokensMatch.length < pala.tokens.length) return null
      const tokensDif = pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t))
      if (!tokensDif.every(t => tokensTitle.includes(t))) return null
      return { pala, score: pala.tokens.length, partial: false }
    })
    .filter(Boolean) as { pala: PalaCatalogo; score: number; partial: boolean }[]

  // ── Fase 2: match PARCIAL si la fase 1 no da nada ────────────────────────
  // Condiciones: ≥60% tokens del modelo en título + todos los diferenciadores presentes
  // Solo se aplica si el resultado es único (evitar falsos positivos por ambigüedad)
  if (scored.length === 0) {
    // Extraer números de modelo del título (01-09, v2, v3... pero NO años 20XX)
    // Estos son tokens que identifican la versión exacta del modelo
    const numerosModelo = titleLower
      .replace(/\b20\d{2}\b/g, '')          // quitar años
      .replace(/hrd\+/g, 'hrd')
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => /^(0[1-9]|v\d+|\d{2})$/.test(t))  // 01-09, v2, v10, etc.

    const parciales = candidatas
      .map(pala => {
        if (anioTitulo !== null && pala.año !== anioTitulo) return null
        if (pala.tokens.length === 0) return null

        // GUARD: si el título contiene un número de modelo (04, 05, v10...)
        // y el modelo del catálogo tiene un número distinto → falso positivo seguro
        if (numerosModelo.length > 0) {
          const numerosModPala = pala.tokens.filter(t => /^(0[1-9]|v\d+|\d{2})$/.test(t))
          if (numerosModPala.length > 0) {
            // El modelo tiene número → debe coincidir con alguno del título
            const hayConflicto = numerosModPala.every(n => !numerosModelo.includes(n))
            if (hayConflicto) return null
          }
        }

        const tokensMatch = pala.tokens.filter(t => tokensTitle.includes(t))
        const ratio = tokensMatch.length / pala.tokens.length
        if (ratio < PARTIAL_MATCH_THRESHOLD) return null
        // Los diferenciadores del modelo SÍ deben estar en el título
        const tokensDif = pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t))
        if (!tokensDif.every(t => tokensTitle.includes(t))) return null
        // Los diferenciadores del título NO pueden apuntar a otro modelo
        const difExtra = [...difEnTitulo].filter(d => !pala.tokens.includes(d))
        if (difExtra.length > 0) return null
        return { pala, score: tokensMatch.length, partial: true }
      })
      .filter(Boolean) as { pala: PalaCatalogo; score: number; partial: boolean }[]

    // Solo asignar si hay un único candidato parcial claro (o varios del mismo año → más reciente)
    if (parciales.length > 0) {
      parciales.sort((a, b) => b.score - a.score)
      const maxScore  = parciales[0].score
      const topParc   = parciales.filter(s => s.score === maxScore)
      if (topParc.length === 1) {
        scored = topParc
      } else {
        const maxAnioP = Math.max(...topParc.map(s => s.pala.año))
        const topAñoP  = topParc.filter(s => s.pala.año === maxAnioP)
        if (topAñoP.length === 1) scored = topAñoP
      }
    }
  }

  if (scored.length === 0) return 'noMatch'

  // ── Desempate 1: fix HRD+→base, Team→base ─────────────────────────────────
  if (difEnTitulo.size > 0) {
    const conDif = scored.filter(s => s.pala.tokens.some(t => TOKENS_DIFERENCIADORES.has(t)))
    if (conDif.length > 0) scored = conDif
  }

  if (scored.length === 0) return 'noMatch'
  if (scored.length === 1) {
    const winner = scored[0].pala
    return { external_id: item.external_id, pala_id: winner.id, titulo: item.title, modelo: winner.modelo }
  }

  // ── Desempate 1b: jugador en título (Juan Lebron, Ale Galan…) ────────────
  // Si el título menciona un jugador → preferir modelos que lo incluyan.
  // Si el título NO menciona jugador → preferir modelos que NO lo incluyan.
  // Los tokens de jugador se eliminan del modelo en extraerTokensModelo(), así que
  // comparamos contra el nombre completo del modelo (en minúsculas normalizado).
  {
    const RE_JUG = new RegExp(JUGADORES_PATTERN.source, 'gi')
    const modeloTieneJugador = (modelo: string) =>
      RE_JUG.test(modelo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))

    if (jugadoresTitulo.length > 0) {
      // Título CON jugador → filtrar a los que lo incluyen
      const conJugador = scored.filter(s => {
        const modeloNorm = s.pala.modelo.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        return jugadoresTitulo.some(j => modeloNorm.includes(j))
      })
      if (conJugador.length > 0 && conJugador.length < scored.length) scored = conJugador
    } else {
      // Título SIN jugador → preferir modelos sin jugador
      const sinJugador = scored.filter(s => {
        const re2 = new RegExp(JUGADORES_PATTERN.source, 'gi')
        return !re2.test(s.pala.modelo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
      })
      if (sinJugador.length > 0 && sinJugador.length < scored.length) scored = sinJugador
    }
  }

  if (scored.length === 0) return 'noMatch'
  if (scored.length === 1) {
    const winner = scored[0].pala
    return { external_id: item.external_id, pala_id: winner.id, titulo: item.title, modelo: winner.modelo }
  }

  // ── Desempate 2: número de versión X.Y ───────────────────────────────────
  if (versionTitulo !== null) {
    const conVersion = scored.filter(s => extraerVersionModelo(s.pala.modelo) === versionTitulo)
    if (conVersion.length > 0) scored = conVersion
  }

  if (scored.length === 1) {
    const winner = scored[0].pala
    return { external_id: item.external_id, pala_id: winner.id, titulo: item.title, modelo: winner.modelo }
  }

  // ── Desempate 3: especificidad de tokens ──────────────────────────────────
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const extraA = a.pala.tokens.filter(t => !tokensTitle.includes(t)).length
    const extraB = b.pala.tokens.filter(t => !tokensTitle.includes(t)).length
    return extraA - extraB
  })

  const maxScore2   = scored[0].score
  const topMatches  = scored.filter(s => s.score === maxScore2)
  const minExtra    = Math.min(...topMatches.map(s => s.pala.tokens.filter(t => !tokensTitle.includes(t)).length))
  const topSinExtra = topMatches.filter(s => s.pala.tokens.filter(t => !tokensTitle.includes(t)).length === minExtra)

  if (topSinExtra.length === 1) {
    const winner = topSinExtra[0].pala
    return { external_id: item.external_id, pala_id: winner.id, titulo: item.title, modelo: winner.modelo }
  }

  // ── Desempate 4: año más reciente ─────────────────────────────────────────
  const maxAnio     = Math.max(...topSinExtra.map(s => s.pala.año))
  const topRecientes = topSinExtra.filter(s => s.pala.año === maxAnio)

  if (topRecientes.length === 1) {
    const winner = topRecientes[0].pala
    return { external_id: item.external_id, pala_id: winner.id, titulo: item.title, modelo: winner.modelo }
  }

  return 'ambiguous'
}

// ─── Función exportable para scrapers ────────────────────────────────────────

export async function matchPalaIds(
  supabase: ReturnType<typeof createClient>,
  opts?: { verbose?: boolean }
): Promise<{ matched: number; ambiguous: number; noMatch: number }> {
  const verbose = opts?.verbose ?? true

  if (verbose) console.log('\n🔗 Match pala_id iniciado...')

  // Supabase limita a 1000 filas por defecto — paginamos para traer todo el catálogo
  const palasRaw: any[] = []
  const PAGE_SIZE = 1000
  let fromRow = 0
  while (true) {
    const { data, error } = await supabase
      .from('palas')
      .select('id, marca, modelo, año')
      .range(fromRow, fromRow + PAGE_SIZE - 1)
    if (error) {
      console.error('❌ matchPalaIds: Error cargando palas:', error)
      return { matched: 0, ambiguous: 0, noMatch: 0 }
    }
    if (!data || data.length === 0) break
    palasRaw.push(...data)
    if (data.length < PAGE_SIZE) break
    fromRow += PAGE_SIZE
  }
  const palasErr = null

  if (!palasRaw || palasRaw.length === 0) {
    console.error('❌ matchPalaIds: sin datos de palas')
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

  // Incluir también anuncios sin marca (se detecta del título)
  const { data: items, error: itemsErr } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, marca')
    .is('pala_id', null)

  if (itemsErr || !items) {
    console.error('❌ matchPalaIds: Error cargando cache:', itemsErr)
    return { matched: 0, ambiguous: 0, noMatch: 0 }
  }

  let matched = 0, ambiguous = 0, noMatch = 0
  const updates: { external_id: string; pala_id: string }[] = []

  for (const item of items as CacheItem[]) {
    const result = matchearItem(item, palasPorMarca)
    if (result === 'noMatch' || result === 'excluido') { noMatch++; continue }
    if (result === 'ambiguous') { ambiguous++; continue }
    matched++
    updates.push({ external_id: result.external_id, pala_id: result.pala_id })
  }

  if (updates.length > 0) {
    const BATCH = 100
    for (let i = 0; i < updates.length; i += BATCH) {
      for (const u of updates.slice(i, i + BATCH)) {
        await supabase
          .from('wallapop_cache')
          .update({ pala_id: u.pala_id })
          .eq('external_id', u.external_id)
      }
    }
  }

  if (verbose) {
    console.log(`  ✅ Match pala_id: ${matched} asignados, ${ambiguous} ambiguos, ${noMatch} sin match`)
  }

  return { matched, ambiguous, noMatch }
}

// ─── main (ejecución standalone) ─────────────────────────────────────────────

async function main() {
  console.log(`🔗 HUNTPADEL — Match pala_id${DRY_RUN ? ' [DRY RUN]' : ''}`)
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  // ── 1. Cargar catálogo de palas ────────────────────────────────────────────
  console.log('📚 Cargando catálogo de palas...')
  // Supabase limita a 1000 filas por defecto — paginamos para traer todo el catálogo
  const palasRaw: any[] = []
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('palas')
      .select('id, marca, modelo, año')
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('❌ Error cargando palas:', error)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    palasRaw.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  const palasErr = null

  if (!palasRaw || palasRaw.length === 0) {
    console.error('❌ Error cargando palas: sin datos')
    process.exit(1)
  }

  const palas: PalaCatalogo[] = palasRaw.map(p => ({
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

  console.log(`  ${palas.length} palas cargadas, ${palasPorMarca.size} marcas\n`)

  // Debug: tokens de palas problemáticas conocidas
  const ejemplosDebug = [
    'Adidas Metalbone HRD',
    'Adidas Metalbone 3.3',
    'Adidas Metalbone 3.4',
    'Babolat Technical Viper 2024',
    'Bullpadel Vertex 03 2023',
    'Bullpadel Hack CTRL',
  ]
  console.log('🔍 Debug tokens de palas clave:')
  for (const ej of ejemplosDebug) {
    const pala = palas.find(p => p.modelo.toLowerCase().includes(ej.toLowerCase()))
    if (pala) {
      const ver = extraerVersionModelo(pala.modelo)
      console.log(`  "${pala.modelo}": tokens:[${pala.tokens.join(', ')}] versión:${ver ?? 'ninguna'}`)
    }
  }
  console.log()

  // ── 2. Cargar anuncios sin pala_id (incluye marca=null) ───────────────────
  console.log('📦 Cargando wallapop_cache sin pala_id...')
  const { data: items, error: itemsErr } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, marca')
    .is('pala_id', null)

  if (itemsErr || !items) {
    console.error('❌ Error cargando wallapop_cache:', itemsErr)
    process.exit(1)
  }

  console.log(`  ${items.length} anuncios sin pala_id\n`)

  // ── 3. Matchear ───────────────────────────────────────────────────────────
  let matched   = 0
  let ambiguous = 0
  let noMatch   = 0
  let excluidos = 0
  const updates: MatchResult[] = []
  const ambiguousItems: { titulo: string; candidatos: PalaCatalogo[] }[] = []

  for (const item of items as CacheItem[]) {
    // Para capturar los candidatos de los ambiguos, necesitamos una versión
    // extendida que devuelva el detalle. Usamos matchearItem + re-run para debug.
    const result = matchearItem(item, palasPorMarca)
    if (result === 'excluido')  { excluidos++; continue }
    if (result === 'noMatch')   { noMatch++;   continue }
    if (result === 'ambiguous') {
      ambiguous++
      // Reconstruir candidatos para el log: filtramos palas de la marca y hacemos match manual
      let marcaNorm = item.marca?.toLowerCase() ?? null
      if (!marcaNorm) {
        const detectada = detectarMarcaDesideTitulo(item.title)
        if (detectada) marcaNorm = detectada.toLowerCase()
      }
      if (marcaNorm === 'star vie') marcaNorm = 'starvie'
      const candidatos = (palasPorMarca.get(marcaNorm ?? '') ?? []).filter(p => {
        const tokensTitle = tokenizar(item.title.toLowerCase())
        const tokensMatch = p.tokens.filter(t => tokensTitle.includes(t))
        return tokensMatch.length >= Math.ceil(p.tokens.length * PARTIAL_MATCH_THRESHOLD)
      })
      ambiguousItems.push({ titulo: item.title, candidatos })
      continue
    }
    matched++
    updates.push(result)
  }

  console.log(`📊 Resultados del matching:`)
  console.log(`  ✅ Matches claros:  ${matched}`)
  console.log(`  ⚠️  Ambiguos:       ${ambiguous}`)
  console.log(`  ❌ Sin match:       ${noMatch}`)
  console.log(`  🚫 Accesorios:      ${excluidos}\n`)

  if (updates.length === 0) {
    console.log('⚠️  Sin actualizaciones que aplicar.')
    return
  }

  // Muestra de matches para revisión visual
  console.log('📋 Muestra de matches (primeros 20):')
  for (const u of updates.slice(0, 20)) {
    console.log(`  "${u.titulo.substring(0, 55)}"`)
    console.log(`    → ${u.modelo}\n`)
  }

  // Detalle de ambiguos
  if (ambiguousItems.length > 0) {
    console.log(`\n⚠️  Detalle ambiguos (${ambiguousItems.length} casos):`)
    for (const a of ambiguousItems) {
      console.log(`  "${a.titulo.substring(0, 60)}"`)
      if (a.candidatos.length > 0) {
        for (const c of a.candidatos) {
          console.log(`    ↔ ${c.modelo} [${c.año}] tokens:[${c.tokens.join(', ')}]`)
        }
      } else {
        console.log(`    ↔ (empate en desempates finales — mismos tokens y año)`)
      }
      console.log()
    }
  }

  if (DRY_RUN) {
    console.log(`🔍 DRY RUN — se aplicarían ${updates.length} actualizaciones.`)
    return
  }

  // ── 4. Aplicar en batches ─────────────────────────────────────────────────
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
