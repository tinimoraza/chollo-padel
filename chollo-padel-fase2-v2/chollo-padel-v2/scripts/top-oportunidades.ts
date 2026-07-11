/**
 * scripts/top-oportunidades.ts
 * ==============================
 * Genera el Top 10 global de oportunidades de segunda mano.
 * LÓGICA v3: frase exacta + exclusiones con regex word-boundary.
 *
 * Pipeline:
 *  1. Para cada modelo curado: buscar en wallapop_cache con ILIKE '%phrase%' (frase exacta)
 *  2. Filtrar: EXCLUIR_SIEMPRE_RE (regex \b) + excludeKeywords del modelo
 *  3. Filtrar: condición new/un_opened/as_good_as_new, precio >= MIN_PRICE
 *  4. Calcular mediana (>= MIN_ITEMS_FOR_MEDIANA para fiabilidad)
 *  5. Oportunidad = precio < mediana × THRESHOLD_OPORTUNIDAD (≥25% de descuento)
 *  6. Deduplicar por external_id, ordenar por % descuento
 *  7. Verificar activos contra API Wallapop (vendidos → descartar y limpiar caché)
 *  8. Guardar TOP_N en top_oportunidades
 *
 * Ejecutar manualmente:
 *   npx tsx --env-file=.env.local scripts/top-oportunidades.ts
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const MIN_PRICE             = 30    // mínimo 30€ para filtrar ruido
const MIN_ITEMS_FOR_MEDIANA = 5     // mínimo de anuncios para calcular mediana fiable
const THRESHOLD_OPORTUNIDAD = 0.75  // precio < mediana × 0.75 → ≥25% de descuento
const TOP_N                 = 10    // tamaño del ranking
const VERIFY_THROTTLE       = 250   // ms entre llamadas a la API de Wallapop

// Condiciones que entran al top
const CONDICIONES_TOP = ['new', 'un_opened', 'as_good_as_new']

// Exclusiones globales con word-boundary (\b) para no fallar en "Hack 04 Jr" al final de string
// Se aplican a TODOS los modelos antes de las excludeKeywords específicas.
const EXCLUIR_SIEMPRE_RE: RegExp[] = [
  /\bjunior\b/i,
  /\bj\.?r\.?\b/i,       // jr, j.r., J.R al final de string también
  /\binfantil\b/i,
  /\bni[ñn][oa]\b/i,     // niño, niña, nino, nina
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

// Modelos curados — búsqueda por FRASE EXACTA (no palabras sueltas en AND).
// phrase: el título debe contener esta frase completa (ILIKE '%phrase%').
// excludeKeywords: palabras adicionales que descalifican el anuncio (string.includes).
interface Modelo {
  nombre: string
  phrase: string
  excludeKeywords?: string[]
}

const MODELOS: Modelo[] = [
  // ── Bullpadel Vertex ──────────────────────────────────────────────────────
  { nombre: 'Bullpadel Vertex 04', phrase: 'vertex 04' },
  { nombre: 'Bullpadel Vertex 05', phrase: 'vertex 05' },

  // ── Bullpadel Hack ────────────────────────────────────────────────────────
  { nombre: 'Bullpadel Hack 04',   phrase: 'hack 04' },

  // ── Joma ─────────────────────────────────────────────────────────────────
  { nombre: 'Joma Tournament Iconic', phrase: 'tournament iconic' },
  { nombre: 'Joma Blast Pro',         phrase: 'joma blast pro' },
  { nombre: 'Joma Hyper Pro',         phrase: 'joma hyper pro' },

  // ── Adidas Metalbone — versión específica por número (cada una su mediana) ─
  { nombre: 'Adidas Metalbone 3.3',
    phrase: 'metalbone 3.3',
    excludeKeywords: ['hrd', 'ctrl', 'carbon', 'team', 'light', 'lite'] },
  { nombre: 'Adidas Metalbone 3.4',
    phrase: 'metalbone 3.4',
    excludeKeywords: ['hrd', 'ctrl', 'carbon', 'team', 'light', 'lite'] },
  { nombre: 'Adidas Metalbone 3.5',
    phrase: 'metalbone 3.5',
    excludeKeywords: ['hrd', 'ctrl', 'carbon', 'team', 'light', 'lite'] },
  { nombre: 'Adidas Metalbone 09',
    phrase: 'metalbone 09' },
  { nombre: 'Adidas Metalbone HRD+',
    phrase: 'metalbone hrd' },
  { nombre: 'Adidas Metalbone CTRL',
    phrase: 'metalbone ctrl',
    excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Metalbone Carbon',
    phrase: 'metalbone carbon' },
  { nombre: 'Adidas Metalbone Team',
    phrase: 'metalbone team',
    excludeKeywords: ['light', 'lite'] },
  { nombre: 'Adidas Metalbone Team Light',
    phrase: 'metalbone team light' },

  // ── Adidas Cross It — versión específica por número ───────────────────────
  { nombre: 'Adidas Cross It 3.4',
    phrase: 'cross it 3.4',
    excludeKeywords: ['ctrl', 'carbon', 'light', 'team'] },
  { nombre: 'Adidas Cross It 3.5',
    phrase: 'cross it 3.5',
    excludeKeywords: ['ctrl', 'carbon', 'light', 'team'] },
  { nombre: 'Adidas Cross It CTRL',
    phrase: 'cross it ctrl',
    excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Cross It Carbon',
    phrase: 'cross it carbon' },
  { nombre: 'Adidas Cross It Light',
    phrase: 'cross it light',
    excludeKeywords: ['team'] },
  { nombre: 'Adidas Cross It Team Light',
    phrase: 'cross it team light' },

  // ── Adidas Arrow Hit ─────────────────────────────────────────────────────
  { nombre: 'Adidas Arrow Hit',
    phrase: 'arrow hit',
    excludeKeywords: ['ctrl', 'carbon', 'edt', 'attk', 'hexagon'] },
  { nombre: 'Adidas Arrow Hit CTRL',
    phrase: 'arrow hit ctrl',
    excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Arrow Hit Carbon',
    phrase: 'arrow hit carbon' },
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

async function isWallapopActive(externalId: string): Promise<boolean> {
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
      return true
    }

    console.warn(`  ⚠️  API Wallapop devolvió ${res.status} para ${externalId} — asumimos activo`)
    return true
  } catch {
    return true
  }
}

async function buscarModelo(supabase: ReturnType<typeof createClient>, modelo: Modelo): Promise<any[]> {
  console.log(`\n🔍 "${modelo.nombre}" — frase: "${modelo.phrase}"`)

  const { data, error } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, price, condition, platform, img, url, city, pala_id, scraped_at')
    .in('condition', CONDICIONES_TOP)
    .gte('price', MIN_PRICE)
    .ilike('title', `%${modelo.phrase}%`)
    .limit(500)

  if (error) {
    console.error(`  ❌ Error:`, error)
    return []
  }

  if (!data || data.length === 0) {
    console.log(`  ⚪ Sin resultados`)
    return []
  }

  // 1. Exclusiones globales con regex word-boundary (junior, jr, reparar, etc.)
  // 2. Exclusiones específicas del modelo (string.includes)
  const antes = data.length
  const items: any[] = data.filter(item => {
    // Regex word-boundary
    if (EXCLUIR_SIEMPRE_RE.some(re => re.test(item.title))) return false
    // Exclusiones del modelo
    if (modelo.excludeKeywords) {
      const t = item.title.toLowerCase()
      if (modelo.excludeKeywords.some(excl => t.includes(excl.toLowerCase()))) return false
    }
    return true
  })

  if (items.length < antes) {
    console.log(`  🚫 ${antes - items.length} descartados (jr/reparar/variante)`)
  }
  console.log(`  📦 ${items.length} anuncios válidos`)

  // Mediana de precios
  const precios = items.map(item => item.price as number)
  const mediana = calcMediana(precios)

  if (mediana === null) {
    console.log(`  ⚠️  Solo ${items.length} items (mín ${MIN_ITEMS_FOR_MEDIANA}) — sin mediana`)
    return []
  }

  console.log(`  📊 Mediana: ${Math.round(mediana)}€ (${items.length} anuncios)`)

  // Oportunidades: precio < mediana × threshold
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
      pala_id:      item.pala_id ?? null,
    })
  }

  console.log(`  💎 ${oportunidades.length} oportunidades (< ${Math.round(umbral)}€)`)
  return oportunidades
}

async function main() {
  console.log('🏆 HUNTPADEL — Top Oportunidades (v3: frase exacta + regex exclusiones)')
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  // ── 0. Guardar posiciones actuales ────────────────────────────────────────
  console.log('📌 Leyendo posiciones actuales...')
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

  // ── 1. Buscar oportunidades por cada modelo ───────────────────────────────
  console.log(`\n🎯 Procesando ${MODELOS.length} modelos curados...`)

  const todasOportunidades: any[] = []
  for (const modelo of MODELOS) {
    const ops = await buscarModelo(supabase, modelo)
    todasOportunidades.push(...ops)
  }

  console.log(`\n✅ ${todasOportunidades.length} oportunidades totales`)

  if (todasOportunidades.length === 0) {
    console.log('⚠️  Sin oportunidades — no se actualiza la tabla.')
    return
  }

  // ── 2. Deduplicar por external_id (mayor descuento gana) ─────────────────
  const deduplicado = new Map<string, any>()
  for (const op of todasOportunidades) {
    const existing = deduplicado.get(op.external_id)
    if (!existing || op.descuento_pct > existing.descuento_pct) {
      deduplicado.set(op.external_id, op)
    }
  }

  const candidatos = Array.from(deduplicado.values())
    .sort((a, b) => b.descuento_pct - a.descuento_pct)

  console.log(`📋 ${candidatos.length} candidatos únicos`)

  // ── 3. Verificar activos contra la API Wallapop ───────────────────────────
  const maxVerificar = Math.min(candidatos.length, TOP_N * 3)
  console.log(`\n🔍 Verificando hasta ${maxVerificar} candidatos...\n`)

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
      ` (-${candidato.descuento_pct}% vs ${Math.round(candidato.precio_medio)}€, [${candidato.keyword}])... `
    )
    const activo = await isWallapopActive(candidato.external_id)

    if (activo) {
      console.log('✅ activo')
      top.push(candidato)
    } else {
      console.log('❌ vendido — descartado')
      vendidosABorrar.push(candidato.external_id)
    }

    await sleep(VERIFY_THROTTLE)
  }

  // ── 4. Calcular tendencias ────────────────────────────────────────────────
  const ahora = new Date().toISOString()
  console.log(`\n🏆 Top ${top.length} final:`)

  const topConTendencia = top.map((op, idx) => {
    const posicionNueva    = idx + 1
    const posicionAnterior = posicionesAnteriores.get(op.external_id) ?? null

    let tendencia: 'nueva_entrada' | 'sube' | 'baja' | 'igual'
    if (posicionAnterior === null)           tendencia = 'nueva_entrada'
    else if (posicionNueva < posicionAnterior) tendencia = 'sube'
    else if (posicionNueva > posicionAnterior) tendencia = 'baja'
    else                                     tendencia = 'igual'

    const puestosMovidos = posicionAnterior !== null ? posicionAnterior - posicionNueva : null

    const label = { nueva_entrada: '🆕', sube: `⬆️ +${puestosMovidos}`, baja: `⬇️ ${puestosMovidos}`, igual: '➡️' }[tendencia]
    console.log(`  ${posicionNueva}. ${label} ${op.title} — ${op.price}€ (mediana: ${Math.round(op.precio_medio)}€, -${op.descuento_pct}%, [${op.keyword}])`)

    return { ...op, posicion: posicionNueva, posicion_anterior: posicionAnterior, puestos_movidos: puestosMovidos, tendencia, updated_at: ahora }
  })

  // ── 5. Limpiar vendidos de wallapop_cache ─────────────────────────────────
  if (vendidosABorrar.length > 0) {
    console.log(`\n🗑️  Eliminando ${vendidosABorrar.length} anuncios vendidos de wallapop_cache...`)
    const { error: delErr } = await supabase.from('wallapop_cache').delete().in('external_id', vendidosABorrar)
    if (delErr) console.error('  ⚠️  Error al borrar:', delErr)
    else        console.log('  ✅ Limpieza OK')
  }

  // ── 6. Guardar el Top en la BD ────────────────────────────────────────────
  if (topConTendencia.length === 0) {
    console.log('\n⚠️  Top vacío — no se actualiza la tabla.')
    return
  }

  console.log(`\n💾 Guardando top ${topConTendencia.length}...`)

  const idsNuevos = topConTendencia.map((op: any) => op.external_id)
  const { error: deleteErr } = await supabase
    .from('top_oportunidades')
    .delete()
    .not('external_id', 'in', `(${idsNuevos.map((id: string) => `"${id}"`).join(',')})`)

  if (deleteErr) console.error('  ⚠️  Error borrando entradas antiguas:', deleteErr)

  const { error: upsertErr } = await supabase
    .from('top_oportunidades')
    .upsert(topConTendencia, { onConflict: 'external_id' })

  if (upsertErr) {
    console.error('❌ Error guardando:', upsertErr)
    process.exit(1)
  }

  console.log(`✅ Top ${topConTendencia.length} guardado correctamente.`)
}

main().catch(err => {
  console.error('❌ Error fatal:', err)
  process.exit(1)
})
