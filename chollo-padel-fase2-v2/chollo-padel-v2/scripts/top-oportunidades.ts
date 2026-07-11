/**
 * scripts/top-oportunidades.ts
 * ==============================
 * Genera el Top 10 global de oportunidades de segunda mano.
 * LÓGICA v2: modelos curados + mediana de segunda mano (sin matching de catálogo).
 *
 * Pipeline:
 *  1. Para cada modelo curado: buscar en wallapop_cache por keywords (ilike AND)
 *  2. Filtrar: condición new/un_opened/as_good_as_new, precio >= MIN_PRICE
 *  3. Calcular mediana de todos los resultados (>= MIN_ITEMS_FOR_MEDIANA para fiabilidad)
 *  4. Oportunidad = precio < mediana × THRESHOLD_OPORTUNIDAD (≥25% de descuento)
 *  5. Deduplicar por external_id, ordenar por % descuento
 *  6. Verificar activos contra API Wallapop (vendidos → descartar y limpiar caché)
 *  7. Guardar TOP_N en top_oportunidades
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

// Palabras que se excluyen SIEMPRE en todos los modelos (ruido / no pala adulta)
// Se aplican en buscarModelo() antes de las excludeKeywords específicas del modelo.
const EXCLUIR_SIEMPRE = [
  // Junior / infantil
  'junior', ' jr ', ' jr.', '-jr', 'infantil', 'niño', 'niña', 'youth', 'kids',
  // Para reparar / dañada
  'reparar', 'reparación', 'reparada', 'reparado', 'para piezas',
  'rota', 'roto', 'dañada', 'dañado', 'fisura', 'crack', 'golpe',
]

// Modelos curados — lista de modelos a buscar con sus keywords.
// Cada keyword debe aparecer en el título (búsqueda AND, case-insensitive).
// excludeKeywords: excluir anuncios cuyo título contenga alguna de estas palabras.
// Las EXCLUIR_SIEMPRE se aplican a todos además de estas.
interface Modelo {
  nombre: string
  keywords: string[]
  excludeKeywords?: string[]
}

const MODELOS: Modelo[] = [
  // ── Bullpadel ──────────────────────────────────────────────────────────────
  { nombre: 'Bullpadel Vertex 04', keywords: ['vertex', '04'] },
  { nombre: 'Bullpadel Vertex 05', keywords: ['vertex', '05'] },
  { nombre: 'Bullpadel Hack 04',   keywords: ['hack', '04'] },

  // ── Joma ───────────────────────────────────────────────────────────────────
  { nombre: 'Joma Tournament Iconic Pro', keywords: ['joma', 'tournament', 'iconic'] },
  { nombre: 'Joma Blast Pro',             keywords: ['joma', 'blast', 'pro'] },
  { nombre: 'Joma Hyper Pro',             keywords: ['joma', 'hyper', 'pro'] },

  // ── Adidas Metalbone — un slot por submodelo, cada uno con su propia mediana ──
  // Metalbone "puro" (3.3 / 3.4 / 3.5 / 09 sin variante especial)
  { nombre: 'Adidas Metalbone',
    keywords: ['adidas', 'metalbone'],
    excludeKeywords: ['hrd', 'team', 'ctrl', 'carbon', 'light', 'lite',
                      'reserve', 'green', 'edt', 'master', 'super'] },

  // HRD+ — variante de ataque premium
  { nombre: 'Adidas Metalbone HRD+',
    keywords: ['metalbone', 'hrd'] },

  // CTRL — variante de control (sin Carbon, que es otro submodelo)
  { nombre: 'Adidas Metalbone CTRL',
    keywords: ['metalbone', 'ctrl'],
    excludeKeywords: ['carbon'] },

  // Carbon — variante estructural (CTRL Carbon / 3.x Carbon)
  { nombre: 'Adidas Metalbone Carbon',
    keywords: ['metalbone', 'carbon'] },

  // Team — gama media (sin Light, que tiene su propio slot)
  { nombre: 'Adidas Metalbone Team',
    keywords: ['metalbone', 'team'],
    excludeKeywords: ['light', 'lite'] },

  // Team Light — la versión ligera de la gama media
  { nombre: 'Adidas Metalbone Team Light',
    keywords: ['metalbone', 'team', 'light'] },

  // ── Adidas Cross It — misma lógica de submodelos que Metalbone ────────────
  // Cross It "puro" (sin variante especial)
  { nombre: 'Adidas Cross It',
    keywords: ['adidas', 'cross', 'it'],
    excludeKeywords: ['team', 'ctrl', 'carbon', 'light', 'lite', 'edt', 'reserve'] },

  // CTRL (sin Carbon)
  { nombre: 'Adidas Cross It CTRL',
    keywords: ['cross', 'it', 'ctrl'],
    excludeKeywords: ['carbon'] },

  // Carbon (CTRL Carbon + 3.x Carbon)
  { nombre: 'Adidas Cross It Carbon',
    keywords: ['cross', 'it', 'carbon'] },

  // Light (sin Team Light, que tiene su propio slot)
  { nombre: 'Adidas Cross It Light',
    keywords: ['cross', 'it', 'light'],
    excludeKeywords: ['team'] },

  // Team Light
  { nombre: 'Adidas Cross It Team Light',
    keywords: ['cross', 'it', 'team', 'light'] },

  // ── Adidas Arrow Hit (gama alta 2026) ─────────────────────────────────────
  // Arrow Hit "puro"
  { nombre: 'Adidas Arrow Hit',
    keywords: ['adidas', 'arrow', 'hit'],
    excludeKeywords: ['ctrl', 'carbon', 'edt', 'attk', 'hexagon'] },

  // Arrow Hit CTRL (sin Carbon)
  { nombre: 'Adidas Arrow Hit CTRL',
    keywords: ['arrow', 'hit', 'ctrl'],
    excludeKeywords: ['carbon'] },

  // Arrow Hit Carbon
  { nombre: 'Adidas Arrow Hit Carbon',
    keywords: ['arrow', 'hit', 'carbon'] },
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
  console.log(`\n🔍 Buscando: "${modelo.nombre}" [${modelo.keywords.join(' + ')}]...`)

  let sb = supabase
    .from('wallapop_cache')
    .select('external_id, title, price, condition, platform, img, url, city, pala_id, scraped_at')
    .in('condition', CONDICIONES_TOP)
    .gte('price', MIN_PRICE)
    .limit(500)

  for (const word of modelo.keywords) {
    sb = (sb as any).ilike('title', `%${word}%`)
  }

  const { data, error } = await (sb as any)

  if (error) {
    console.error(`  ❌ Error buscando "${modelo.nombre}":`, error)
    return []
  }

  if (!data || data.length === 0) {
    console.log(`  ⚪ Sin resultados`)
    return []
  }

  // Aplicar filtros de exclusión en cliente (EXCLUIR_SIEMPRE + excludeKeywords del modelo)
  let items: any[] = data
  const todosExcluidos = [...EXCLUIR_SIEMPRE, ...(modelo.excludeKeywords ?? [])]
  {
    const antes = items.length
    items = items.filter(item => {
      const titleLower = item.title.toLowerCase()
      return !todosExcluidos.some(excl => titleLower.includes(excl.toLowerCase()))
    })
    if (items.length < antes) {
      console.log(`  🚫 Excluidos ${antes - items.length} anuncios (ruido/junior/reparar + exclusiones del modelo)`)
    }
  }

  console.log(`  📦 ${items.length} anuncios en condición top`)

  // Calcular mediana de todos los precios encontrados
  const precios = items.map(item => item.price as number)
  const mediana = calcMediana(precios)

  if (mediana === null) {
    console.log(`  ⚠️  Solo ${items.length} items (mínimo ${MIN_ITEMS_FOR_MEDIANA} para calcular mediana) — modelo ignorado`)
    return []
  }

  console.log(`  📊 Mediana: ${Math.round(mediana)}€ sobre ${items.length} anuncios`)

  // Filtrar oportunidades: precio < mediana × THRESHOLD
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

  console.log(`  💎 ${oportunidades.length} oportunidades (precio < ${Math.round(umbral)}€)`)
  return oportunidades
}

async function main() {
  console.log('🏆 HUNTPADEL — Top Oportunidades (v2: modelos curados + mediana de segunda mano)')
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  // ── 0. Guardar posiciones actuales ────────────────────────────────────────
  console.log('📌 Leyendo posiciones actuales del top...')
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

  // ── 1. Buscar oportunidades por cada modelo curado ────────────────────────
  console.log(`\n🎯 Procesando ${MODELOS.length} modelos curados...`)

  const todasOportunidades: any[] = []
  for (const modelo of MODELOS) {
    const ops = await buscarModelo(supabase, modelo)
    todasOportunidades.push(...ops)
  }

  console.log(`\n✅ ${todasOportunidades.length} oportunidades totales encontradas`)

  if (todasOportunidades.length === 0) {
    console.log('⚠️  Sin oportunidades — no se actualiza la tabla.')
    return
  }

  // ── 2. Deduplicar por external_id (mayor descuento gana si aparece en varios modelos) ──
  const deduplicado = new Map<string, any>()
  for (const op of todasOportunidades) {
    const existing = deduplicado.get(op.external_id)
    if (!existing || op.descuento_pct > existing.descuento_pct) {
      deduplicado.set(op.external_id, op)
    }
  }

  const candidatos = Array.from(deduplicado.values())
    .sort((a, b) => b.descuento_pct - a.descuento_pct)

  console.log(`📋 ${candidatos.length} candidatos únicos, ordenados por % descuento`)

  // ── 3. Verificar activos contra la API Wallapop ───────────────────────────
  const maxVerificar = Math.min(candidatos.length, TOP_N * 3)
  console.log(`\n🔍 Verificando hasta ${maxVerificar} candidatos contra la API de Wallapop...\n`)

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
      ` (${candidato.descuento_pct}% dto vs mediana ${Math.round(candidato.precio_medio)}€,` +
      ` ${candidato.condition}, [${candidato.keyword}])... `
    )
    const activo = await isWallapopActive(candidato.external_id)

    if (activo) {
      console.log('✅ activo')
      top.push(candidato)
    } else {
      console.log('❌ vendido/retirado — descartado')
      vendidosABorrar.push(candidato.external_id)
    }

    await sleep(VERIFY_THROTTLE)
  }

  // ── 4. Calcular tendencias tipo ranking musical ───────────────────────────
  const ahora = new Date().toISOString()

  console.log(`\n🏆 Top ${top.length} final con tendencias:`)

  const topConTendencia = top.map((op, idx) => {
    const posicionNueva    = idx + 1
    const posicionAnterior = posicionesAnteriores.get(op.external_id) ?? null

    let tendencia: 'nueva_entrada' | 'sube' | 'baja' | 'igual'
    if (posicionAnterior === null) {
      tendencia = 'nueva_entrada'
    } else if (posicionNueva < posicionAnterior) {
      tendencia = 'sube'
    } else if (posicionNueva > posicionAnterior) {
      tendencia = 'baja'
    } else {
      tendencia = 'igual'
    }

    const puestosMovidos = posicionAnterior !== null
      ? posicionAnterior - posicionNueva
      : null

    const tendenciaLabel = {
      nueva_entrada: '🆕',
      sube:          `⬆️  +${puestosMovidos}`,
      baja:          `⬇️  ${puestosMovidos}`,
      igual:         '➡️',
    }[tendencia]

    console.log(
      `  ${posicionNueva}. ${tendenciaLabel} ${op.title} — ${op.price}€` +
      ` (mediana: ${Math.round(op.precio_medio)}€, -${op.descuento_pct}%, [${op.keyword}])`
    )

    return {
      ...op,
      posicion:          posicionNueva,
      posicion_anterior: posicionAnterior,
      puestos_movidos:   puestosMovidos,
      tendencia,
      updated_at:        ahora,
    }
  })

  // ── 5. Limpiar vendidos de wallapop_cache ─────────────────────────────────
  if (vendidosABorrar.length > 0) {
    console.log(`\n🗑️  Eliminando ${vendidosABorrar.length} anuncios vendidos de wallapop_cache...`)
    const { error: delErr } = await supabase
      .from('wallapop_cache')
      .delete()
      .in('external_id', vendidosABorrar)
    if (delErr) {
      console.error('  ⚠️  Error al borrar de wallapop_cache:', delErr)
    } else {
      console.log('  ✅ Limpieza completada')
    }
  }

  // ── 6. Guardar el Top en la BD ────────────────────────────────────────────
  if (topConTendencia.length === 0) {
    console.log('\n⚠️  Top vacío — no se actualiza la tabla.')
    return
  }

  console.log(`\n💾 Guardando top ${topConTendencia.length} en top_oportunidades...`)

  // Borrar entradas anteriores que ya no están en el nuevo top
  const idsNuevos = topConTendencia.map((op: any) => op.external_id)
  const { error: deleteErr } = await supabase
    .from('top_oportunidades')
    .delete()
    .not('external_id', 'in', `(${idsNuevos.map((id: string) => `"${id}"`).join(',')})`)

  if (deleteErr) {
    console.error('  ⚠️  Error borrando entradas antiguas:', deleteErr)
  }

  // Upsert del nuevo top
  const { error: upsertErr } = await supabase
    .from('top_oportunidades')
    .upsert(topConTendencia, { onConflict: 'external_id' })

  if (upsertErr) {
    console.error('❌ Error guardando top_oportunidades:', upsertErr)
    process.exit(1)
  }

  console.log(`✅ Top ${topConTendencia.length} guardado correctamente.`)
}

main().catch(err => {
  console.error('❌ Error fatal:', err)
  process.exit(1)
})
