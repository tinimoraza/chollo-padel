/**
 * scripts/top-oportunidades.ts
 * ===========================================
 * Genera el Top 10 global de oportunidades de segunda mano.
 * Lo ejecuta GitHub Actions cada hora.
 *
 * Lógica:
 *  1. Lee wallapop_cache filtrando por CONDICIONES_TOP (new, un_opened, as_good_as_new)
 *  2. Solo grupos con ≥5 anuncios y precio ≥ MIN_PRICE (55€)
 *  3. Precio medio calculado SOLO con new + un_opened (más fiable)
 *  4. Marca como oportunidad los que están ≥25% por debajo de ese precio medio
 *  5. Ordena por SCORE COMPUESTO: descuento × peso_condición × bonus_año × bonus_recencia
 *  6. Guarda posición anterior y calcula tendencia (nueva_entrada / sube / baja / igual)
 *  7. Verifica los finalistas contra la API de Wallapop (vendidos → borrar y rellenar)
 *  8. Reemplaza COMPLETAMENTE top_oportunidades con el nuevo ranking (TOP_N = 10)
 *
 * Ejecutar manualmente:
 *   npx tsx --env-file=.env.local scripts/top-oportunidades.ts
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const MIN_PRICE            = 55   // Subido de 30 → 55€ para filtrar ruido
const MIN_ITEMS_GRUPO      = 5    // Mínimo anuncios por grupo para mediana fiable
const DESCUENTO_MIN        = 25   // % mínimo de descuento para ser oportunidad
const TOP_N                = 10   // Tamaño del ranking
const VERIFY_THROTTLE      = 250  // ms entre llamadas a la API de Wallapop

// Condiciones que entran al top
const CONDICIONES_TOP          = ['new', 'un_opened', 'as_good_as_new']
// Para el precio medio solo usamos las más fiables (sabemos que no se han usado)
const CONDICIONES_PRECIO_MEDIO = ['new', 'un_opened']
const MIN_ITEMS_PRECIO_MEDIO   = 3  // mínimo new/un_opened para usar precio medio fiable

// Pesos por condición — new es el rey, as_good_as_new se penaliza por ser la más "mentida"
const PESO_CONDICION: Record<string, number> = {
  new:            1.00,
  un_opened:      0.85,
  as_good_as_new: 0.60,
}

// Años en título: bonus si es reciente, penalización si es viejo
// Sin año → neutro (no penalizamos la ausencia, pero sí la vetustez cuando aparece)
function scoreAnio(title: string): number {
  const match = title.match(/20(1[89]|2[0-9])/)
  if (!match) return 1.0
  const anio = parseInt(match[0])
  if (anio >= 2024) return 1.15   // modelo reciente → bonus
  if (anio === 2023) return 0.90  // 2023 → ligera penalización
  return 0.65                     // ≤2022 → penalización fuerte (pala vieja)
}

// Recencia del anuncio en BD — más reciente = más probable que siga activo
function scoreRecencia(scrapedAt: string | null): number {
  if (!scrapedAt) return 0.85
  const dias = (Date.now() - new Date(scrapedAt).getTime()) / (1000 * 60 * 60 * 24)
  if (dias <= 2) return 1.00
  if (dias <= 7) return 0.85
  return 0.60  // más de 7 días → algo raro si sigue en BD con ese precio
}

/**
 * Score compuesto final.
 * Combina % descuento × peso condición × bonus año × bonus recencia.
 * El log del ahorro absoluto evita premiar solo % y valora también los € ahorrados.
 */
function calcularScore(
  descuentoPct: number,
  condition: string,
  title: string,
  scrapedAt: string | null,
  precioMedio: number,
  price: number
): number {
  const pesoCondicion = PESO_CONDICION[condition] ?? 0.5
  const pesoAnio      = scoreAnio(title)
  const pesoRecencia  = scoreRecencia(scrapedAt)
  const ahorroAbs     = precioMedio - price
  const bonusAhorro   = Math.log10(Math.max(ahorroAbs, 1) + 1)

  return descuentoPct * pesoCondicion * pesoAnio * pesoRecencia * bonusAhorro
}

const EXCLUIR_PALABRAS = [
  'junior', 'infantil', 'niño', 'niña', 'reparada', 'reparado', 'dañada', 'dañado',
  'rota', 'roto', 'golpe', 'paletero', 'mochila', 'bolsa', 'zapatilla', 'zapatillas',
  'funda', 'grip', 'bolas', 'pelota', 'pelotas', 'ropa',
  'camiseta', 'muñequera', 'overgrip', 'protector', 'antivibrador', 'lote',
]

const MARCAS = [
  { regex: /bullpadel/i,    marca: 'Bullpadel' },
  { regex: /adidas/i,       marca: 'Adidas' },
  { regex: /babolat/i,      marca: 'Babolat' },
  { regex: /\bnox\b/i,      marca: 'Nox' },
  { regex: /\bhead\b/i,     marca: 'Head' },
  { regex: /wilson/i,       marca: 'Wilson' },
  { regex: /siux/i,         marca: 'Siux' },
  { regex: /vibora/i,       marca: 'Vibora' },
  { regex: /star.?vie/i,    marca: 'Starvie' },
  { regex: /drop.?shot/i,   marca: 'Drop Shot' },
  { regex: /royal.?padel/i, marca: 'Royal Padel' },
  { regex: /kuikma/i,       marca: 'Kuikma' },
  { regex: /varlion/i,      marca: 'Varlion' },
  { regex: /black.?crown/i, marca: 'Black Crown' },
  { regex: /dunlop/i,       marca: 'Dunlop' },
  { regex: /enebe/i,        marca: 'Enebe' },
  { regex: /oxdog/i,        marca: 'Oxdog' },
  { regex: /\bpuma\b/i,     marca: 'Puma' },
  { regex: /akkeron/i,      marca: 'Akkeron' },
  { regex: /\bjoma\b/i,     marca: 'Joma' },
  { regex: /kombat/i,       marca: 'Kombat' },
  { regex: /\bloc\b/i,      marca: 'Lok' },
  { regex: /alkemia/i,      marca: 'Alkemia' },
  { regex: /softee/i,       marca: 'Softee' },
  { regex: /kelme/i,        marca: 'Kelme' },
  { regex: /ocho.?padel/i,  marca: 'Ocho Padel' },
]

function detectarMarca(title: string): string | null {
  for (const { regex, marca } of MARCAS) {
    if (regex.test(title)) return marca
  }
  return null
}

function extraerModelo(title: string, marca: string): string {
  const lower = title.toLowerCase()
  const sinPrefijo = lower.replace(
    /^(pala de pádel|pala de padel|pala pádel|pala padel|raqueta de pádel|raqueta padel|pala|raqueta)\s+/i,
    ''
  )
  const marcaLower = marca.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sinMarca = sinPrefijo.replace(new RegExp(marcaLower, 'i'), '').trim()
  const palabras = sinMarca.split(/\s+/).filter(Boolean).slice(0, 2)
  return palabras.join(' ').trim()
}

function mediana(precios: number[]): number {
  const sorted = [...precios].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

interface CacheItem {
  external_id: string
  title:       string
  price:       number
  condition:   string
  platform:    string
  img:         string | null
  url:         string
  city:        string | null
  pala_id:     string | null
  marca:       string | null
  scraped_at:  string | null
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

async function main() {
  console.log('🏆 HUNTPADEL — Top Oportunidades')
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  // ── 0. Guardar posiciones actuales antes de tocar nada ───────────────────
  console.log('📌 Leyendo posiciones actuales del top...')
  const { data: topActual } = await supabase
    .from('top_oportunidades')
    .select('external_id, posicion')
    .order('posicion', { ascending: true })

  const posicionesAnteriores = new Map<string, number>()
  if (topActual) {
    for (const row of topActual) {
      if (row.external_id && row.posicion) {
        posicionesAnteriores.set(row.external_id, row.posicion)
      }
    }
  }
  console.log(`  ${posicionesAnteriores.size} entradas en el top actual\n`)

  // ── 1. Leer candidatos de wallapop_cache ──────────────────────────────────
  console.log('📦 Leyendo wallapop_cache...')
  const { data: items, error } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, price, condition, platform, img, url, city, pala_id, marca, scraped_at')
    .in('condition', CONDICIONES_TOP)
    .gte('price', MIN_PRICE)

  if (error || !items) {
    console.error('❌ Error leyendo wallapop_cache:', error)
    process.exit(1)
  }

  console.log(`📊 ${items.length} anuncios en condición top con precio ≥ ${MIN_PRICE}€\n`)

  // ── 2. Filtrar accesorios y agrupar por marca + modelo ────────────────────
  const grupos = new Map<string, { items: CacheItem[], marca: string, modelo: string }>()

  for (const item of items as CacheItem[]) {
    const titleLower = item.title.toLowerCase()
    if (EXCLUIR_PALABRAS.some(p => titleLower.includes(p))) continue

    const marca = item.marca ?? detectarMarca(item.title)
    if (!marca) continue

    const modelo = extraerModelo(item.title, marca)
    if (!modelo) continue

    const clave = `${marca}||${modelo}`
    if (!grupos.has(clave)) {
      grupos.set(clave, { items: [], marca, modelo })
    }
    grupos.get(clave)!.items.push(item)
  }

  console.log(`🔍 ${grupos.size} grupos marca+modelo detectados`)

  // ── 3. Calcular oportunidades con score compuesto ─────────────────────────
  const todasOportunidades: any[] = []

  for (const [, grupo] of grupos) {
    if (grupo.items.length < MIN_ITEMS_GRUPO) continue

    // Precio medio solo con new + un_opened si hay suficientes; si no, fallback a todos
    const itemsPrecioMedio = grupo.items.filter(i => CONDICIONES_PRECIO_MEDIO.includes(i.condition))
    const preciosParaMediana = itemsPrecioMedio.length >= MIN_ITEMS_PRECIO_MEDIO
      ? itemsPrecioMedio.map(i => i.price)
      : grupo.items.map(i => i.price)
    const usandoFiable = itemsPrecioMedio.length >= MIN_ITEMS_PRECIO_MEDIO

    const med = mediana(preciosParaMediana)

    const oportunidades = grupo.items
      .filter(item => item.price < med * (1 - DESCUENTO_MIN / 100))
      .map(item => {
        const descuentoPct = Math.round(((med - item.price) / med) * 100)
        const score = calcularScore(
          descuentoPct,
          item.condition,
          item.title,
          item.scraped_at,
          med,
          item.price
        )
        return {
          external_id:   item.external_id,
          title:         item.title,
          price:         item.price,
          precio_medio:  Math.round(med * 100) / 100,
          descuento_pct: descuentoPct,
          score:         Math.round(score * 100) / 100,
          condition:     item.condition,
          platform:      item.platform,
          img:           item.img,
          url:           item.url,
          city:          item.city,
          keyword:       `${grupo.marca} ${grupo.modelo}`,
          pala_id:       item.pala_id,
        }
      })

    if (oportunidades.length > 0) {
      console.log(
        `  💎 ${grupo.marca} ${grupo.modelo}: mediana ${med}€` +
        ` (${usandoFiable ? 'new/un_opened' : 'fallback todos'}),` +
        ` ${oportunidades.length} oportunidades`
      )
      todasOportunidades.push(...oportunidades)
    }
  }

  console.log(`\n📊 Total oportunidades brutas: ${todasOportunidades.length}`)

  // ── 4. Deduplicar y ordenar por SCORE ────────────────────────────────────
  const deduplicado = new Map<string, any>()
  for (const op of todasOportunidades) {
    const existing = deduplicado.get(op.external_id)
    if (!existing || op.score > existing.score) {
      deduplicado.set(op.external_id, op)
    }
  }

  const candidatos = Array.from(deduplicado.values())
    .sort((a, b) => b.score - a.score)

  console.log(`📋 ${candidatos.length} candidatos únicos ordenados por score`)

  if (candidatos.length === 0) {
    console.log('⚠️  Sin candidatos — no se actualiza la tabla.')
    return
  }

  // ── 5. Verificar activos contra la API — rellenar hasta TOP_N ────────────
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
      ` (score: ${candidato.score}, ${candidato.descuento_pct}% dto, ${candidato.condition})... `
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

  // ── 6. Calcular tendencia tipo ranking musical ────────────────────────────
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
      ? posicionAnterior - posicionNueva  // positivo = sube, negativo = baja
      : null

    const tendenciaLabel = {
      nueva_entrada: '🆕',
      sube:          `⬆️  +${puestosMovidos}`,
      baja:          `⬇️  ${puestosMovidos}`,
      igual:         '➡️',
    }[tendencia]

    console.log(
      `  ${posicionNueva}. ${tendenciaLabel} [score: ${op.score}] ` +
      `${op.title} — ${op.price}€ (mediana: ${op.precio_medio}€, ${op.descuento_pct}% dto, ${op.condition})`
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

  // ── 7. Limpiar vendidos de wallapop_cache ─────────────────────────────────
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

  // ── 8. Guardar el Top en la BD ────────────────────────────────────────────
  if (topConTendencia.length === 0) {
    console.log('\n⚠️  Sin anuncios activos en el Top — no se actualiza la tabla.')
    return
  }

  const { error: deleteError } = await supabase
    .from('top_oportunidades')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')

  if (deleteError) {
    console.error('❌ Error borrando top_oportunidades:', deleteError)
    return
  }

  const { error: insertError } = await supabase
    .from('top_oportunidades')
    .insert(topConTendencia)

  if (insertError) {
    console.error('❌ Error insertando Top:', insertError)
    return
  }

  console.log(`\n✅ Top ${topConTendencia.length} guardado en top_oportunidades.`)
  if (vendidosABorrar.length > 0) {
    console.log(`🧹 ${vendidosABorrar.length} anuncios vendidos eliminados de wallapop_cache de paso.`)
  }
  console.log('🏁 Top Oportunidades completado.\n')
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
