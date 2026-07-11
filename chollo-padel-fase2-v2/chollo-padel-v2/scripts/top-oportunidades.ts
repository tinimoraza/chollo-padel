/**
 * scripts/top-oportunidades.ts
 * ==============================
 * Genera el Top 10 global de oportunidades de segunda mano.
 * LÓGICA v3: frase exacta + exclusiones con regex word-boundary.
 *
 * Ejecutar manualmente:
 *   npx tsx --env-file=.env.local scripts/top-oportunidades.ts
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const MIN_PRICE             = 30
const MIN_ITEMS_FOR_MEDIANA = 5
const THRESHOLD_OPORTUNIDAD = 0.75
const TOP_N                 = 10
const VERIFY_THROTTLE       = 250

const CONDICIONES_TOP = ['new', 'un_opened', 'as_good_as_new']

const EXCLUIR_SIEMPRE_RE: RegExp[] = [
  /\bjunior\b/i,
  /\bj\.?r\.?\b/i,
  /\binfantil\b/i,
  /\bni[ñn][oa]\b/i,
  /\byouth\b/i,
  /\bkids?\b/i,
  /\breparar\b/i,
  /\breparaci[oó]n\b/i,
  /\breparad[ao]\b/i,
  /\bpara piezas\b/i,
  /\brot[ao]\b/i,
  /\bda[ñn]ad[ao]\b/i,
  /\bfisura\b/i,
  /\bcrack\b/i,
  /\bgolpe\b/i,
  /\bno funciona\b/i,
]

interface Modelo {
  nombre: string
  phrase: string
  excludeKeywords?: string[]
}

const MODELOS: Modelo[] = [
  // ── Bullpadel ─────────────────────────────────────────────────────────────
  { nombre: 'Bullpadel Vertex 04',               phrase: 'vertex 04' },
  { nombre: 'Bullpadel Vertex 05',               phrase: 'vertex 05' },
  { nombre: 'Bullpadel Hack 04',                 phrase: 'hack 04' },
  { nombre: 'Bullpadel Neuron 02 2026',          phrase: 'neuron 02 2026',          excludeKeywords: ['edge','chingotto'] },
  { nombre: 'Bullpadel Neuron 02 Edge 2026',     phrase: 'neuron 02 edge 2026' },
  { nombre: 'Bullpadel Neuron 02 Chingotto 2026',phrase: 'neuron 02 chingotto 2026' },
  { nombre: 'Bullpadel Ionic Power 2025',        phrase: 'ionic power 2025' },
  { nombre: 'Bullpadel Ionic Power 2026',        phrase: 'ionic power 2026' },

  // ── Head ──────────────────────────────────────────────────────────────────
  { nombre: 'Head Radical Pro 2024',             phrase: 'radical pro 2024' },
  { nombre: 'Head Radical Motion 2024',          phrase: 'radical motion 2024' },
  { nombre: 'Head Radical Elite 2024',           phrase: 'radical elite 2024' },
  { nombre: 'Head Radical Pro 2026',             phrase: 'radical pro 2026' },
  { nombre: 'Head Radical Motion 2026',          phrase: 'radical motion 2026' },
  { nombre: 'Head Radical Team 2026',            phrase: 'radical team 2026' },
  { nombre: 'Head Speed Pro 2025',               phrase: 'speed pro 2025' },
  { nombre: 'Head Speed Motion 2025',            phrase: 'speed motion 2025' },
  { nombre: 'Head Speed One X 2025',             phrase: 'speed one x 2025' },
  { nombre: 'Head Coello Pro 2026',              phrase: 'coello pro 2026' },
  { nombre: 'Head Extreme Motion 2025',          phrase: 'extreme motion 2025' },
  { nombre: 'Head Gravity Team 2025',            phrase: 'gravity team 2025' },

  // ── Babolat ───────────────────────────────────────────────────────────────
  { nombre: 'Babolat Technical Viper 3.0',             phrase: 'technical viper 3.0',          excludeKeywords: ['soft'] },
  { nombre: 'Babolat Technical Viper Soft 3.0',        phrase: 'technical viper soft 3.0' },
  { nombre: 'Babolat Technical Viper 2025',            phrase: 'technical viper 2025',         excludeKeywords: ['soft','lebron'] },
  { nombre: 'Babolat Technical Viper 2026',            phrase: 'technical viper 2026',         excludeKeywords: ['soft','lebron'] },
  { nombre: 'Babolat Technical Viper Lebron 2026',     phrase: 'technical viper lebron 2026',  excludeKeywords: ['soft'] },
  { nombre: 'Babolat Technical Viper Soft Lebron 2026',phrase: 'technical viper soft lebron 2026' },
  { nombre: 'Babolat Counter Viper 2025',              phrase: 'counter viper 2025' },
  { nombre: 'Babolat Counter Viper 2026',              phrase: 'counter viper 2026' },
  { nombre: 'Babolat Air Viper 2025',                  phrase: 'air viper 2025' },
  { nombre: 'Babolat Air Viper 2026',                  phrase: 'air viper 2026' },
  { nombre: 'Babolat Air Vertuo 2026',                 phrase: 'air vertuo 2026' },
  { nombre: 'Babolat Viper Juan Lebron',               phrase: 'viper juan lebr',              excludeKeywords: ['2026'] },
  { nombre: 'Babolat Viper Juan Lebron 2026',          phrase: 'viper juan lebron 2026' },

  // ── Nox ───────────────────────────────────────────────────────────────────
  { nombre: 'Nox AT10 18K 2026',                phrase: 'at10 18k' },
  { nombre: 'Nox AT10 12K 2026',                phrase: 'at10 12k' },
  { nombre: 'Nox ML10 Ventus Control 3K 2026',  phrase: 'ml10 ventus control 3k' },
  { nombre: 'Nox ML10 Ventus Control 3K 2026',  phrase: 'ml10 3k 2026' },
  { nombre: 'Nox EA10 Ventus Attack 2026',       phrase: 'ea10 ventus attack 2026' },
  { nombre: 'Nox EA10 Ventus Attack 2026',       phrase: 'ea10 attack 2026' },

  // ── Black Crown ───────────────────────────────────────────────────────────
  { nombre: 'Black Crown Piton 14 2026',         phrase: 'piton 14 2026' },
  { nombre: 'Black Crown Piton Blue 2026',       phrase: 'piton blue 2026' },

  // ── Joma ──────────────────────────────────────────────────────────────────
  { nombre: 'Joma Tournament Iconic',            phrase: 'tournament iconic' },
  { nombre: 'Joma Blast Pro',                    phrase: 'joma blast pro',           excludeKeywords: ['hrd','sft'] },
  { nombre: 'Joma Blast Pro HRD 2026',           phrase: 'blast pro hrd 2026' },
  { nombre: 'Joma Blast Pro SFT 2026',           phrase: 'blast pro sft 2026' },
  { nombre: 'Joma Hyper Pro',                    phrase: 'joma hyper pro',           excludeKeywords: ['hrd'] },
  { nombre: 'Joma Hyper Pro HRD 2026',           phrase: 'hyper pro hrd 2026' },
  { nombre: 'Joma Hyper 3.0',                    phrase: 'joma hyper 3.0' },
  { nombre: 'Joma Gold Pro 2.0',                 phrase: 'joma gold pro 2.0' },
  { nombre: 'Joma Tournament Soft 2.0',          phrase: 'tournament soft 2.0' },
  { nombre: 'Joma Tournament Flex 2.0',          phrase: 'tournament flex 2.0' },

  // ── Siux ──────────────────────────────────────────────────────────────────
  { nombre: 'Siux Trilogy Elite 2026',           phrase: 'trilogy elite 2026' },
  { nombre: 'Siux Trilogy Pro 5 2025',           phrase: 'trilogy pro 5 2025' },
  { nombre: 'Siux Trilogy Pro 2026',             phrase: 'trilogy pro 2026',         excludeKeywords: ['elite','5'] },
  { nombre: 'Siux Electra Pro 2026',             phrase: 'electra pro 2026' },
  { nombre: 'Siux Diablo Elite 2026',            phrase: 'diablo elite 2026' },
  { nombre: 'Siux Diablo Pro 2026',              phrase: 'diablo pro 2026',          excludeKeywords: ['elite'] },
  { nombre: 'Siux Fenix Pro 2026',               phrase: 'fenix pro 2026' },
  { nombre: 'Siux Astra Hybrid 2026',            phrase: 'astra hybrid 2026' },

  // ── Wilson ────────────────────────────────────────────────────────────────
  { nombre: 'Wilson Defy Pro V1 2025',           phrase: 'defy pro v1 2025' },
  { nombre: 'Wilson Defy Pro V1 2026',           phrase: 'defy pro v1 2026' },
  { nombre: 'Wilson Defy V1 Special Edition 2026',phrase: 'defy v1 special edition 2026' },
  { nombre: 'Wilson Defy LS 2026',               phrase: 'defy ls 2026' },
  { nombre: 'Wilson Endure Pro V1 2026',         phrase: 'endure pro v1 2026' },
  { nombre: 'Wilson Endure LS 2026',             phrase: 'endure ls 2026' },
  { nombre: 'Wilson Bela LT 2.5',               phrase: 'bela lt 2.5' },

  // ── Adidas Metalbone puro ─────────────────────────────────────────────────
  { nombre: 'Adidas Metalbone 3.3', phrase: 'metalbone 3.3',
    excludeKeywords: ['hrd', 'ctrl', 'carbon', 'team', 'light', 'lite'] },
  { nombre: 'Adidas Metalbone 3.4', phrase: 'metalbone 3.4',
    excludeKeywords: ['hrd', 'ctrl', 'carbon', 'team', 'light', 'lite'] },
  { nombre: 'Adidas Metalbone 3.5', phrase: 'metalbone 3.5',
    excludeKeywords: ['hrd', 'ctrl', 'carbon', 'team', 'light', 'lite'] },
  { nombre: 'Adidas Metalbone 09',  phrase: 'metalbone 09' },

  // ── Adidas Metalbone HRD+ ─────────────────────────────────────────────────
  { nombre: 'Adidas Metalbone HRD+ 3.3', phrase: 'metalbone hrd 3.3' },
  { nombre: 'Adidas Metalbone HRD+ 3.3', phrase: 'metalbone 3.3 hrd' },
  { nombre: 'Adidas Metalbone HRD+ 3.4', phrase: 'metalbone hrd 3.4' },
  { nombre: 'Adidas Metalbone HRD+ 3.4', phrase: 'metalbone 3.4 hrd' },
  { nombre: 'Adidas Metalbone HRD+ 3.5', phrase: 'metalbone hrd 3.5' },
  { nombre: 'Adidas Metalbone HRD+ 3.5', phrase: 'metalbone 3.5 hrd' },

  // ── Adidas Metalbone CTRL ─────────────────────────────────────────────────
  { nombre: 'Adidas Metalbone CTRL 3.3', phrase: 'metalbone ctrl 3.3', excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Metalbone CTRL 3.3', phrase: 'metalbone 3.3 ctrl', excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Metalbone CTRL 3.4', phrase: 'metalbone ctrl 3.4', excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Metalbone CTRL 3.4', phrase: 'metalbone 3.4 ctrl', excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Metalbone CTRL 3.5', phrase: 'metalbone ctrl 3.5', excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Metalbone CTRL 3.5', phrase: 'metalbone 3.5 ctrl', excludeKeywords: ['carbon'] },

  // ── Adidas Metalbone Carbon CTRL ──────────────────────────────────────────
  { nombre: 'Adidas Metalbone Carbon CTRL 3.3', phrase: 'metalbone carbon ctrl 3.3' },
  { nombre: 'Adidas Metalbone Carbon CTRL 3.4', phrase: 'metalbone carbon ctrl 3.4' },
  { nombre: 'Adidas Metalbone Carbon CTRL 3.5', phrase: 'metalbone carbon ctrl 3.5' },

  // ── Adidas Metalbone Team ─────────────────────────────────────────────────
  { nombre: 'Adidas Metalbone Team 3.3', phrase: 'metalbone team 3.3', excludeKeywords: ['light', 'lite'] },
  { nombre: 'Adidas Metalbone Team 3.4', phrase: 'metalbone team 3.4', excludeKeywords: ['light', 'lite'] },
  { nombre: 'Adidas Metalbone Team 3.5', phrase: 'metalbone team 3.5', excludeKeywords: ['light', 'lite'] },

  // ── Adidas Metalbone Team Light ───────────────────────────────────────────
  { nombre: 'Adidas Metalbone Team Light 3.3', phrase: 'metalbone team light 3.3' },
  { nombre: 'Adidas Metalbone Team Light 3.4', phrase: 'metalbone team light 3.4' },
  { nombre: 'Adidas Metalbone Team Light 3.5', phrase: 'metalbone team light 3.5' },

  // ── Adidas Cross It puro ──────────────────────────────────────────────────
  { nombre: 'Adidas Cross It 3.4', phrase: 'cross it 3.4',
    excludeKeywords: ['ctrl', 'carbon', 'light', 'team'] },
  { nombre: 'Adidas Cross It 3.5', phrase: 'cross it 3.5',
    excludeKeywords: ['ctrl', 'carbon', 'light', 'team'] },

  // ── Adidas Cross It Light ─────────────────────────────────────────────────
  { nombre: 'Adidas Cross It Light 3.3', phrase: 'cross it light 3.3' },
  { nombre: 'Adidas Cross It Light 3.4', phrase: 'cross it light 3.4' },
  { nombre: 'Adidas Cross It Light 3.5', phrase: 'cross it light 3.5' },

  // ── Adidas Arrow Hit ──────────────────────────────────────────────────────
  { nombre: 'Adidas Arrow Hit 3.3', phrase: 'arrow hit 3.3',
    excludeKeywords: ['ctrl', 'carbon'] },
  { nombre: 'Adidas Arrow Hit 3.4', phrase: 'arrow hit 3.4',
    excludeKeywords: ['ctrl', 'carbon'] },
  { nombre: 'Adidas Arrow Hit CTRL 3.3', phrase: 'arrow hit ctrl 3.3',
    excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Arrow Hit CTRL 3.3', phrase: 'arrow hit 3.3 ctrl',
    excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Arrow Hit Carbon 3.3', phrase: 'arrow hit carbon 3.3' },
  { nombre: 'Adidas Arrow Hit Carbon 3.4', phrase: 'arrow hit carbon 3.4' },

  // ── StarVie ───────────────────────────────────────────────────────────────
  { nombre: 'StarVie Triton Pro 2024',           phrase: 'triton pro 2024' },
  { nombre: 'StarVie Triton Power 2026',         phrase: 'triton power' },
  { nombre: 'StarVie Triton Balance 2026',       phrase: 'triton balance' },
  { nombre: 'StarVie Basalto Osiris',            phrase: 'basalto osiris' },

  // ── Vairo ─────────────────────────────────────────────────────────────────
  { nombre: 'Vairo 6.1',                         phrase: 'vairo 6.1' },
  { nombre: 'Vairo 8.1',                         phrase: 'vairo 8.1' },

  // ── Vibor-A ───────────────────────────────────────────────────────────────
  { nombre: 'Vibor-A Yarara Radical 12K',        phrase: 'yarara radical 12k' },
  { nombre: 'Vibor-A Yarara Xtreme 3K',          phrase: 'yarara xtreme 3k' },

  // ── Oxdog ─────────────────────────────────────────────────────────────────
  { nombre: 'Oxdog Ultimate Pro 2026',           phrase: 'oxdog ultimate pro 2026' },
  { nombre: 'Oxdog Hyper Pro 2.0',               phrase: 'oxdog hyper pro 2.0' },

  // ── Drop Shot ─────────────────────────────────────────────────────────────
  { nombre: 'Drop Shot Explorer Pro Attack 2.0', phrase: 'explorer pro attack 2.0' },
  { nombre: 'Drop Shot Axion Attack 2.0',        phrase: 'axion attack 2.0' },
]

function calcMediana(precios: number[]): number | null {
  if (precios.length < MIN_ITEMS_FOR_MEDIANA) return null
  const sorted = [...precios].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function isWallapopActive(externalId: string, phrase?: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.wallapop.com/api/v3/items/${externalId}`, {
      headers: {
        'Accept':          'application/json',
        'MPlatform':       'WEB',
        'Accept-Language': 'es-ES',
      },
    })

    if (res.status === 404 || res.status === 410) return false

    if (res.ok) {
      const data = await res.json()
      if (data?.reserved?.flag === true) return false
      if (data?.sold?.flag === true) return false
      if (data?.item?.flags?.sold || data?.item?.flags?.reserved) return false

      if (phrase) {
        const currentTitle = (
          data?.item?.title ??
          data?.content?.title ??
          data?.title ??
          ''
        ).toLowerCase()
        if (currentTitle.length > 0 && !currentTitle.includes(phrase.toLowerCase())) {
          console.log(`  Titulo cambio - ya no contiene "${phrase}" - descartado y limpiado`)
          return false
        }
      }

      return true
    }

    console.warn(`  API Wallapop devolvio ${res.status} para ${externalId} - asumimos activo`)
    return true
  } catch {
    return true
  }
}

async function buscarModelo(supabase: any, modelo: Modelo): Promise<any[]> {
  console.log(`\nBuscando "${modelo.nombre}" - frase: "${modelo.phrase}"`)

  const { data, error } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, price, condition, platform, img, url, city, pala_id, scraped_at')
    .in('condition', CONDICIONES_TOP)
    .gte('price', MIN_PRICE)
    .ilike('title', `%${modelo.phrase}%`)
    .limit(500)

  if (error) {
    console.error(`  Error:`, error)
    return []
  }

  if (!data || data.length === 0) {
    console.log(`  Sin resultados`)
    return []
  }

  const antes = data.length
  const items: any[] = (data as any[]).filter(item => {
    if (EXCLUIR_SIEMPRE_RE.some(re => re.test(item.title))) return false
    if (modelo.excludeKeywords) {
      const t = item.title.toLowerCase()
      if (modelo.excludeKeywords.some(excl => t.includes(excl.toLowerCase()))) return false
    }
    return true
  })

  if (items.length < antes) {
    console.log(`  ${antes - items.length} descartados (jr/reparar/variante)`)
  }
  console.log(`  ${items.length} anuncios validos`)

  const precios = items.map(item => item.price as number)
  const mediana = calcMediana(precios)

  if (mediana === null) {
    console.log(`  Solo ${items.length} items (min ${MIN_ITEMS_FOR_MEDIANA}) - sin mediana`)
    return []
  }

  console.log(`  Mediana: ${Math.round(mediana)}EUR (${items.length} anuncios)`)

  const umbral = mediana * THRESHOLD_OPORTUNIDAD
  const oportunidades: any[] = []

  for (const item of items) {
    if (item.price >= umbral) continue
    const descuento_pct = Math.round(((mediana - item.price) / mediana) * 100)
    oportunidades.push({
      external_id:  item.external_id,
      title:        item.title,
      price:        item.price,
      precio_medio: Math.round(mediana * 100) / 100,
      descuento_pct,
      score:        descuento_pct,
      condition:    item.condition,
      platform:     item.platform,
      img:          item.img ?? null,
      url:          item.url,
      city:         item.city ?? null,
      keyword:      modelo.nombre,
      phrase:       modelo.phrase,
      pala_id:      item.pala_id ?? null,
    })
  }

  console.log(`  ${oportunidades.length} oportunidades (< ${Math.round(umbral)}EUR)`)
  return oportunidades
}

async function main() {
  console.log('HUNTPADEL - Top Oportunidades (v3: frase exacta + regex exclusiones)')
  console.log(`Fecha: ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  console.log('Leyendo posiciones actuales...')
  const { data: topActual } = await supabase
    .from('top_oportunidades')
    .select('external_id, posicion')
    .order('posicion', { ascending: true })

  const posicionesAnteriores = new Map<string, number>()
  if (topActual) {
    for (const row of topActual as any[]) {
      if (row.external_id && row.posicion) {
        posicionesAnteriores.set(row.external_id, row.posicion)
      }
    }
  }
  console.log(`  ${posicionesAnteriores.size} entradas en el top actual`)

  console.log(`\nProcesando ${MODELOS.length} modelos curados...`)

  const todasOportunidades: any[] = []
  for (const modelo of MODELOS) {
    const ops = await buscarModelo(supabase, modelo)
    todasOportunidades.push(...ops)
  }

  console.log(`\n${todasOportunidades.length} oportunidades totales`)

  if (todasOportunidades.length === 0) {
    console.log('Sin oportunidades - no se actualiza la tabla.')
    return
  }

  const deduplicado = new Map<string, any>()
  for (const op of todasOportunidades) {
    const existing = deduplicado.get(op.external_id)
    if (!existing || op.descuento_pct > existing.descuento_pct) {
      deduplicado.set(op.external_id, op)
    }
  }

  const candidatos = Array.from(deduplicado.values())
    .sort((a, b) => b.descuento_pct - a.descuento_pct)

  console.log(`${candidatos.length} candidatos unicos`)

  const maxVerificar = Math.min(candidatos.length, TOP_N * 3)
  console.log(`\nVerificando hasta ${maxVerificar} candidatos...\n`)

  const top: any[] = []
  const vendidosABorrar: string[] = []

  for (let i = 0; i < maxVerificar && top.length < TOP_N; i++) {
    const candidato = candidatos[i]

    if (candidato.platform !== 'wallapop') {
      top.push(candidato)
      continue
    }

    process.stdout.write(
      `  [${i + 1}/${maxVerificar}] ${candidato.external_id}` +
      ` (-${candidato.descuento_pct}% vs ${Math.round(candidato.precio_medio)}EUR, [${candidato.keyword}])... `
    )
    const activo = await isWallapopActive(candidato.external_id, candidato.phrase)

    if (activo) {
      console.log('activo')
      top.push(candidato)
    } else {
      console.log('vendido - descartado')
      vendidosABorrar.push(candidato.external_id)
    }

    await sleep(VERIFY_THROTTLE)
  }

  const ahora = new Date().toISOString()
  console.log(`\nTop ${top.length} final:`)

  const topConTendencia = top.map((op, idx) => {
    const posicionNueva    = idx + 1
    const posicionAnterior = posicionesAnteriores.get(op.external_id) ?? null

    let tendencia: 'nueva_entrada' | 'sube' | 'baja' | 'igual'
    if (posicionAnterior === null)             tendencia = 'nueva_entrada'
    else if (posicionNueva < posicionAnterior) tendencia = 'sube'
    else if (posicionNueva > posicionAnterior) tendencia = 'baja'
    else                                       tendencia = 'igual'

    const puestosMovidos = posicionAnterior !== null ? posicionAnterior - posicionNueva : null

    console.log(`  ${posicionNueva}. ${op.title} - ${op.price}EUR (mediana: ${Math.round(op.precio_medio)}EUR, -${op.descuento_pct}%, [${op.keyword}])`)

    return { ...op, posicion: posicionNueva, posicion_anterior: posicionAnterior, puestos_movidos: puestosMovidos, tendencia, updated_at: ahora }
  })

  if (vendidosABorrar.length > 0) {
    console.log(`\nEliminando ${vendidosABorrar.length} anuncios vendidos de wallapop_cache...`)
    const { error: delErr } = await supabase.from('wallapop_cache').delete().in('external_id', vendidosABorrar)
    if (delErr) console.error('  Error al borrar:', delErr)
    else        console.log('  Limpieza OK')
  }

  if (topConTendencia.length === 0) {
    console.log('\nTop vacio - no se actualiza la tabla.')
    return
  }

  console.log(`\nGuardando top ${topConTendencia.length}...`)

  const idsNuevos = topConTendencia.map((op: any) => op.external_id)
  const { error: deleteErr } = await supabase
    .from('top_oportunidades')
    .delete()
    .not('external_id', 'in', `(${idsNuevos.map((id: string) => `"${id}"`).join(',')})`)

  if (deleteErr) console.error('  Error borrando entradas antiguas:', deleteErr)

  const { error: upsertErr } = await supabase
    .from('top_oportunidades')
    .upsert(topConTendencia, { onConflict: 'external_id' })

  if (upsertErr) {
    console.error('Error guardando:', upsertErr)
    process.exit(1)
  }

  console.log(`Top ${topConTendencia.length} guardado correctamente.`)
}

main().catch(err => {
  console.error('Error fatal:', err)
  process.exit(1)
})
