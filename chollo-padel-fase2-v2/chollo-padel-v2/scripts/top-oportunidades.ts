/**
 * scripts/top-oportunidades.ts
 * ===========================================
 * Genera el Top 10 global de oportunidades de segunda mano.
 * Lo ejecuta GitHub Actions cada hora.
 *
 * Lógica:
 *  1. Lee wallapop_cache filtrando por CONDICIONES_TOP (new, un_opened, as_good_as_new)
 *     SOLO anuncios con pala_id asignado (match confirmado con catálogo)
 *  2. Carga price_reference para esos pala_id (precio oficial de tiendas scrapeadas)
 *     Anuncios cuyo pala_id no tiene precio en price_reference → excluidos
 *  3. Descuento calculado contra precio_referencia de tienda (NO mediana de segunda mano)
 *     Esto da descuentos reales respecto al precio de mercado nuevo
 *  4. Ordena por SCORE COMPUESTO:
 *       descuento × peso_condición × bonus_año × bonus_recencia × bonus_ahorro
 *     - Sin año en título → penalización 0.85
 *     - Año viejo (≤2022) → penalización fuerte 0.65
 *  5. Guarda posición anterior y calcula tendencia (nueva_entrada/sube/baja/igual)
 *  6. Verifica finalistas contra API Wallapop (vendidos → borrar y rellenar)
 *  7. Reemplaza COMPLETAMENTE top_oportunidades con el nuevo ranking (TOP_N = 10)
 *
 * Ejecutar manualmente:
 *   npx tsx --env-file=.env.local scripts/top-oportunidades.ts
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const MIN_PRICE         = 55    // mínimo 55€ para filtrar ruido
const DESCUENTO_MIN     = 25   // % mínimo de descuento respecto al precio de tienda
const TOP_N             = 10   // tamaño del ranking
const MAX_POR_PALA_ID   = 1    // máximo 1 anuncio por modelo en el top (mejor score)
const VERIFY_THROTTLE   = 250  // ms entre llamadas a la API de Wallapop

// Condiciones que entran al top
const CONDICIONES_TOP = ['new', 'un_opened', 'as_good_as_new']

// Pesos por condición
const PESO_CONDICION: Record<string, number> = {
  new:            1.00,
  un_opened:      1.00,
  as_good_as_new: 0.60,
}

// Extrae el año del título si existe (2018-2029)
function extraerAnio(title: string): number | null {
  const match = title.match(/20(1[89]|2[0-9])/)
  return match ? parseInt(match[0]) : null
}

function scoreAnio(title: string): number {
  const anio = extraerAnio(title)
  if (anio === null) return 0.85
  if (anio >= 2024)  return 1.15
  if (anio === 2023) return 0.90
  return 0.65
}

function scoreRecencia(scrapedAt: string | null): number {
  if (!scrapedAt) return 0.85
  const dias = (Date.now() - new Date(scrapedAt).getTime()) / (1000 * 60 * 60 * 24)
  if (dias <= 2) return 1.00
  if (dias <= 7) return 0.85
  return 0.60
}

function calcularScore(
  descuentoPct: number,
  condition: string,
  title: string,
  scrapedAt: string | null,
  precioReferencia: number,
  price: number,
): number {
  const pesoCondicion = PESO_CONDICION[condition] ?? 0.5
  const pesoAnio      = scoreAnio(title)
  const pesoRecencia  = scoreRecencia(scrapedAt)
  const ahorroAbs     = precioReferencia - price
  const bonusAhorro   = Math.log10(Math.max(ahorroAbs, 1) + 1)

  return descuentoPct * pesoCondicion * pesoAnio * pesoRecencia * bonusAhorro
}

const EXCLUIR_PALABRAS = [
  'junior', 'infantil', 'niño', 'niña', 'youth',  // palas infantiles/junior
  'reparada', 'reparado', 'dañada', 'dañado',
  'rota', 'roto', 'golpe', 'paletero', 'mochila', 'bolsa', 'zapatilla', 'zapatillas',
  'funda', 'grip', 'bolas', 'pelota', 'pelotas', 'ropa',
  'camiseta', 'muñequera', 'overgrip', 'protector', 'antivibrador', 'lote',
]

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
  pala_id:     string
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

  // ── 0. Guardar posiciones actuales ────────────────────────────────────────
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

  // ── 1. Leer price_reference — precios oficiales de tiendas ───────────────
  console.log('💰 Cargando precios de referencia de tiendas...')
  const { data: precios, error: preciosErr } = await supabase
    .from('price_reference')
    .select('pala_id, precio_referencia')

  if (preciosErr || !precios) {
    console.error('❌ Error cargando price_reference:', preciosErr)
    process.exit(1)
  }

  // Mapa pala_id → precio_referencia (precio de tienda oficial)
  const preciosPorPalaId = new Map<string, number>()
  for (const p of precios) {
    if (p.pala_id && p.precio_referencia) {
      preciosPorPalaId.set(p.pala_id, p.precio_referencia)
    }
  }
  console.log(`  ${preciosPorPalaId.size} palas con precio de tienda\n`)

  // ── 2. Leer candidatos de wallapop_cache — SOLO con pala_id ──────────────
  console.log('📦 Leyendo wallapop_cache (solo anuncios con pala_id)...')
  const { data: items, error } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, price, condition, platform, img, url, city, pala_id, marca, scraped_at')
    .in('condition', CONDICIONES_TOP)
    .gte('price', MIN_PRICE)
    .not('pala_id', 'is', null)

  if (error || !items) {
    console.error('❌ Error leyendo wallapop_cache:', error)
    process.exit(1)
  }

  console.log(`📊 ${items.length} anuncios con pala_id en condición top con precio ≥ ${MIN_PRICE}€\n`)

  // ── 3. Calcular oportunidades contra precio de tienda ────────────────────
  console.log('🔍 Calculando oportunidades contra precio de referencia de tienda...\n')

  const todasOportunidades: any[] = []
  let sinPrecioTienda = 0

  for (const item of items as CacheItem[]) {
    const titleLower = item.title.toLowerCase()
    if (EXCLUIR_PALABRAS.some(p => titleLower.includes(p))) continue

    // Precio oficial de tienda para esta pala
    const precioTienda = preciosPorPalaId.get(item.pala_id)
    if (!precioTienda) {
      sinPrecioTienda++
      continue  // sin precio de tienda → no podemos calcular descuento real
    }

    // Descuento respecto al precio de tienda
    if (item.price >= precioTienda * (1 - DESCUENTO_MIN / 100)) continue

    const descuentoPct = Math.round(((precioTienda - item.price) / precioTienda) * 100)
    const score = calcularScore(
      descuentoPct,
      item.condition,
      item.title,
      item.scraped_at,
      precioTienda,
      item.price,
    )

    const anio = extraerAnio(item.title)
    todasOportunidades.push({
      external_id:   item.external_id,
      title:         item.title,
      price:         item.price,
      precio_medio:  precioTienda,   // precio de referencia de tienda (precio "nuevo")
      descuento_pct: descuentoPct,
      score:         Math.round(score * 100) / 100,
      condition:     item.condition,
      platform:      item.platform,
      img:           item.img,
      url:           item.url,
      city:          item.city,
      keyword:       anio
        ? `${item.marca ?? ''} ${anio}`.trim()
        : (item.marca ?? item.title.substring(0, 30)),
      pala_id:       item.pala_id,
    })
  }

  console.log(`  💎 ${todasOportunidades.length} oportunidades encontradas`)
  console.log(`  ⚠️  ${sinPrecioTienda} anuncios sin precio de tienda (excluidos)`)

  // ── 4. Deduplicar y ordenar por score ────────────────────────────────────
  const deduplicado = new Map<string, any>()
  for (const op of todasOportunidades) {
    const existing = deduplicado.get(op.external_id)
    if (!existing || op.score > existing.score) {
      deduplicado.set(op.external_id, op)
    }
  }

  const candidatos = Array.from(deduplicado.values())
    .sort((a, b) => b.score - a.score)

  // Diversidad: máximo MAX_POR_PALA_ID anuncios del mismo modelo en los candidatos a verificar
  const conteoPorPalaId = new Map<string, number>()
  const candidatosDiversos = candidatos.filter(op => {
    const count = conteoPorPalaId.get(op.pala_id) ?? 0
    if (count >= MAX_POR_PALA_ID) return false
    conteoPorPalaId.set(op.pala_id, count + 1)
    return true
  })

  console.log(`\n📋 ${candidatos.length} candidatos únicos → ${candidatosDiversos.length} tras deduplicar por modelo (1 por pala_id, mejor score)`)

  if (candidatosDiversos.length === 0) {
    console.log('⚠️  Sin candidatos — no se actualiza la tabla.')
    return
  }

  // ── 5. Verificar activos contra la API ───────────────────────────────────
  const maxVerificar = Math.min(candidatosDiversos.length, TOP_N * 3)
  console.log(`\n🔍 Verificando hasta ${maxVerificar} candidatos contra la API de Wallapop...\n`)

  const top: any[] = []
  const vendidosABorrar: string[] = []

  for (let i = 0; i < maxVerificar && top.length < TOP_N; i++) {
    const candidato = candidatosDiversos[i]

    if (candidato.platform !== 'wallapop') {
      top.push(candidato)
      continue
    }

    process.stdout.write(
      `  [${i + 1}/${maxVerificar}] ${candidato.external_id}` +
      ` (score: ${candidato.score}, ${candidato.descuento_pct}% dto vs tienda, ${candidato.condition})... `
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
      ? posicionAnterior - posicionNueva
      : null

    const tendenciaLabel = {
      nueva_entrada: '🆕',
      sube:          `⬆️  +${puestosMovidos}`,
      baja:          `⬇️  ${puestosMovidos}`,
      igual:         '➡️',
    }[tendencia]

    console.log(
      `  ${posicionNueva}. ${tendenciaLabel} [score: ${op.score}] ` +
      `${op.title} — ${op.price}€ (precio tienda: ${op.precio_medio}€, ${op.descuento_pct}% dto, ${op.condition})`
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
