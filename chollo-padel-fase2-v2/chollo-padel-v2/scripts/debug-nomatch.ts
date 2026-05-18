/**
 * scripts/debug-nomatch.ts
 * Analiza los 639 "sin match" para entender por qué no matchean.
 *
 * Ejecutar:
 *   npx tsx --env-file=.env.local scripts/debug-nomatch.ts
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

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
const VERSION_PATTERN = /\b(\d+\.\d+)\b/
const MARCAS_CONOCIDAS: Record<string, string> = {
  'bullpadel': 'Bullpadel', 'nox': 'Nox', 'head': 'Head',
  'adidas': 'Adidas', 'babolat': 'Babolat', 'wilson': 'Wilson',
  'dunlop': 'Dunlop', 'starvie': 'StarVie', 'star vie': 'StarVie',
  'vibora': 'Vibora', 'víbora': 'Vibora', 'siux': 'Siux',
  'royal padel': 'Royal Padel', 'royal': 'Royal Padel',
  'drop shot': 'Drop Shot', 'dropshot': 'Drop Shot',
  'tecnifibre': 'Tecnifibre', 'black crown': 'Black Crown',
  'blackcrown': 'Black Crown', 'varlion': 'Varlion',
  'volt': 'Volt', 'tamanaco': 'Tamanaco',
}

function tokenizar(texto: string): string[] {
  return texto.toLowerCase()
    .replace(/hrd\+/g, 'hrd').replace(/\bctr\b/g, 'ctrl')
    .replace(/[^\w\s]/g, ' ').split(/\s+/)
    .filter(t => t.length >= 2)
    .filter(t => KEEP_WORDS.has(t) || (!STOP_WORDS.has(t) && (!/^\d+$/.test(t) || /^0[1-9]$/.test(t))))
}

function extraerAnio(texto: string): number | null {
  const m = texto.match(/\b(20(1[89]|2[0-9]))\b/)
  return m ? parseInt(m[1]) : null
}

function extraerTokensModelo(modelo: string, marca: string): string[] {
  return tokenizar(
    modelo
      .replace(new RegExp(`^${marca}\\s+`, 'i'), '')
      .replace(/\b20\d{2}\b/, '')
      .replace(/\b(juan lebron|ale galan|ale galán|martita ortega|alex ruiz|agustin tapia|agustín tapia)\b/gi, '')
      .trim()
  )
}

function detectarMarca(titulo: string): string | null {
  const tl = titulo.toLowerCase()
  for (const [key, val] of Object.entries(MARCAS_CONOCIDAS))
    if (key.includes(' ') && tl.includes(key)) return val
  for (const [key, val] of Object.entries(MARCAS_CONOCIDAS))
    if (!key.includes(' ') && tl.split(/\s+/).includes(key)) return val
  return null
}

interface Pala { id: string; marca: string; modelo: string; año: number; tokens: string[] }
interface Item  { external_id: string; title: string; marca: string | null }

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  console.log('📚 Cargando catálogo...')
  const { data: palasRaw } = await supabase.from('palas').select('id, marca, modelo, año')
  const palas: Pala[] = palasRaw!.map((p: any) => ({ ...p, tokens: extraerTokensModelo(p.modelo, p.marca) }))
  const porMarca = new Map<string, Pala[]>()
  for (const p of palas) {
    const m = p.marca.toLowerCase()
    if (!porMarca.has(m)) porMarca.set(m, [])
    porMarca.get(m)!.push(p)
  }
  const marcasEnCatalogo = new Set(palas.map(p => p.marca.toLowerCase()))

  console.log('📦 Cargando wallapop_cache sin pala_id...')
  const { data: items } = await supabase
    .from('wallapop_cache').select('external_id, title, marca').is('pala_id', null)

  // ── Clasificar cada "sin match" ───────────────────────────────────────────
  const grupos = {
    accesorio:          [] as string[],  // bolsa, grip, etc.
    sin_marca_bd:       [] as string[],  // marca=null en BD y no detectable del título
    marca_detectada_nomatch: [] as {titulo: string, marca: string, razon: string}[],  // marca OK pero modelo no encontrado
    marca_bd_nomatch:   [] as {titulo: string, marca: string, razon: string}[],  // tiene marca en BD pero modelo no matchea
    marca_fuera_catalogo: [] as {titulo: string, marca: string}[],  // marca detectada pero no está en catálogo
  }

  for (const item of (items ?? []) as Item[]) {
    const tl = item.title.toLowerCase()

    // Accesorios
    if ([...EXCLUIR].some(w => tl.includes(w))) {
      grupos.accesorio.push(item.title)
      continue
    }

    // Resolver marca
    const marcaBD       = item.marca?.toLowerCase() ?? null
    const marcaDetect   = detectarMarca(item.title)?.toLowerCase() ?? null
    const marcaEfectiva = marcaBD ?? marcaDetect

    if (!marcaEfectiva) {
      grupos.sin_marca_bd.push(item.title)
      continue
    }

    // ¿La marca está en el catálogo?
    if (!marcasEnCatalogo.has(marcaEfectiva)) {
      grupos.marca_fuera_catalogo.push({ titulo: item.title, marca: marcaEfectiva })
      continue
    }

    const candidatas = porMarca.get(marcaEfectiva) ?? []
    const anioTitulo  = extraerAnio(item.title)
    const tokensTitle = tokenizar(tl)
    const version     = (() => { const sinAnio = item.title.replace(/\b20\d{2}\b/g, ''); const m = sinAnio.match(VERSION_PATTERN); return m ? m[1] : null })()

    // Intentar match básico (sin desempates)
    const candidateTokenMatches = candidatas.map(pala => {
      if (anioTitulo !== null && pala.año !== anioTitulo) return { pala, fallo: 'año_distinto' }
      const tokensMatch = pala.tokens.filter(t => tokensTitle.includes(t))
      if (tokensMatch.length === 0) return { pala, fallo: 'sin_tokens_comunes' }
      if (tokensMatch.length < pala.tokens.length) return { pala, fallo: `tokens_parciales (${tokensMatch.join(',')} de ${pala.tokens.join(',')})` }
      const tokensDif = pala.tokens.filter(t => TOKENS_DIF.has(t))
      if (!tokensDif.every(t => tokensTitle.includes(t))) return { pala, fallo: `dif_faltante (${tokensDif.filter(t => !tokensTitle.includes(t)).join(',')})` }
      return { pala, fallo: null }
    })

    const sinFallo = candidateTokenMatches.filter(c => c.fallo === null)

    let razon: string
    if (sinFallo.length === 0) {
      // Cuál es el fallo más frecuente
      const fallos: Record<string, number> = {}
      for (const c of candidateTokenMatches) {
        const f = c.fallo!.split(' ')[0]
        fallos[f] = (fallos[f] ?? 0) + 1
      }
      const falloTop = Object.entries(fallos).sort((a,b) => b[1]-a[1])[0]
      razon = `${falloTop[0]} (${falloTop[1]} candidatos)`
      // Añadir muestra del mejor candidato parcial
      const mejorParcial = candidateTokenMatches
        .filter(c => c.fallo?.startsWith('tokens_parciales'))
        .sort((a,b) => {
          const ta = a.pala.tokens.filter(t => tokensTitle.includes(t)).length
          const tb = b.pala.tokens.filter(t => tokensTitle.includes(t)).length
          return tb - ta
        })[0]
      if (mejorParcial) razon += ` | mejor parcial: "${mejorParcial.pala.modelo}"`
    } else {
      razon = `match_posible_pero_descartado (${sinFallo.length} candidatos)`
    }

    const entry = { titulo: item.title, marca: marcaEfectiva, razon }
    if (marcaBD) grupos.marca_bd_nomatch.push(entry)
    else         grupos.marca_detectada_nomatch.push(entry)
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  const total = (items ?? []).length
  console.log(`\n📊 Diagnóstico de ${total} anuncios sin pala_id:\n`)
  console.log(`  🚫 Accesorios (ya filtrados):         ${grupos.accesorio.length}`)
  console.log(`  ❓ Sin marca (BD null + no detectable): ${grupos.sin_marca_bd.length}`)
  console.log(`  🏷️  Marca fuera del catálogo:           ${grupos.marca_fuera_catalogo.length}`)
  console.log(`  🔍 Marca en BD, modelo no matchea:     ${grupos.marca_bd_nomatch.length}`)
  console.log(`  🔎 Marca detectada del título, no match:${grupos.marca_detectada_nomatch.length}`)

  // ── Detalle: marcas fuera del catálogo ───────────────────────────────────
  if (grupos.marca_fuera_catalogo.length > 0) {
    const porMarcaFuera: Record<string, number> = {}
    for (const e of grupos.marca_fuera_catalogo)
      porMarcaFuera[e.marca] = (porMarcaFuera[e.marca] ?? 0) + 1
    console.log(`\n🏷️  Marcas fuera del catálogo (top):`)
    Object.entries(porMarcaFuera).sort((a,b) => b[1]-a[1]).slice(0, 15)
      .forEach(([m, n]) => console.log(`    ${n.toString().padStart(3)}x  ${m}`))
  }

  // ── Detalle: razones de no match con marca en BD ──────────────────────────
  if (grupos.marca_bd_nomatch.length > 0) {
    const porRazon: Record<string, number> = {}
    for (const e of grupos.marca_bd_nomatch) {
      const r = e.razon.split(' ')[0]
      porRazon[r] = (porRazon[r] ?? 0) + 1
    }
    console.log(`\n🔍 Razones de no-match (con marca en BD):`)
    Object.entries(porRazon).sort((a,b) => b[1]-a[1])
      .forEach(([r, n]) => console.log(`    ${n.toString().padStart(3)}x  ${r}`))

    console.log(`\n  Muestra (primeros 20):`)
    for (const e of grupos.marca_bd_nomatch.slice(0, 20))
      console.log(`    [${e.marca}] "${e.titulo.substring(0,55)}" → ${e.razon}`)
  }

  // ── Detalle: sin marca ────────────────────────────────────────────────────
  if (grupos.sin_marca_bd.length > 0) {
    console.log(`\n❓ Sin marca — muestra (primeros 15):`)
    for (const t of grupos.sin_marca_bd.slice(0, 15))
      console.log(`    "${t.substring(0, 70)}"`)
  }
}

main().catch(err => { console.error('💥', err); process.exit(1) })
