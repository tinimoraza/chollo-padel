/**
 * scripts/top-oportunidades.ts
 * ===========================================
 * Genera el Top 10 global de oportunidades de segunda mano.
 * Lo ejecuta GitHub Actions cada hora.
 *
 * Lógica:
 *  1. Lee wallapop_cache agrupando por marca + modelo (extraído del título)
 *  2. Solo grupos con ≥5 anuncios new/un_opened/as_good_as_new y precio > 30€
 *  3. Calcula la mediana de precio por grupo
 *  4. Marca como oportunidad los que están ≥25% por debajo de la mediana
 *  5. Deduplica por external_id, ordena por % descuento desc — candidatos al Top
 *  6. [NUEVO] Verifica los finalistas contra la API de Wallapop:
 *       - Vendidos/retirados → se borran de wallapop_cache + se descartan
 *       - Si quedan huecos, se rellenan con los siguientes candidatos
 *  7. Reemplaza COMPLETAMENTE top_oportunidades con el nuevo ranking
 *
 * Ejecutar manualmente:
 *   npx tsx --env-file=.env.local scripts/top-oportunidades.ts
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const MIN_PRICE       = 30   // Ignorar anuncios por debajo de 30€
const MIN_ITEMS_GRUPO = 5    // Mínimo anuncios por grupo para mediana fiable
const DESCUENTO_MIN   = 25   // % mínimo de descuento para ser oportunidad
const TOP_N           = 10   // Tamaño del ranking
const VERIFY_THROTTLE = 250  // ms entre llamadas a la API de Wallapop

// 'good' incluido para Vinted: su condición 2 ("Muy bueno") se mapea a 'good'
// y representa artículos en excelente estado — sin él, Vinted queda excluido casi entero.
const CONDICIONES_BUENAS = ['new', 'un_opened', 'as_good_as_new', 'good']

const EXCLUIR_PALABRAS = [
  'junior', 'infantil', 'niño', 'niña', 'reparada', 'reparado', 'dañada', 'dañado', 'rota', 'roto', 'golpe', 'paletero',
  'mochila', 'bolsa', 'zapatilla', 'zapatillas',
  'funda', 'grip', 'bolas', 'pelota', 'pelotas', 'ropa',
  'camiseta', 'muñequera', 'overgrip', 'protector', 'antivibrador', 'lote',
]

// Marcas conocidas con sus regex de detección
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
  { regex: /\blok\b/i,      marca: 'Lok' },
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

// Extrae las 2 primeras palabras del título después de la marca como modelo
function extraerModelo(title: string, marca: string): string {
  const lower = title.toLowerCase()
  const sinPrefijo = lower
    .replace(/^(pala de pádel|pala de padel|pala pádel|pala padel|raqueta de pádel|raqueta padel|pala|raqueta)\s+/i, '')
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
}

/**
 * Verifica si un anuncio de Wallapop sigue activo.
 * Reutiliza la misma lógica que scrape-wallapop.ts.
 * Devuelve true si está activo, false si está vendido/retirado.
 */
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
      const flags = data?.item?.flags ?? {}
      if (flags.sold || flags.reserved || data?.item?.status === 'sold') return false
      return true
    }

    // Otros errores (429, 5xx...) → asumir activo para no borrar por error de red
    console.warn(`  ⚠️  API Wallapop devolvió ${res.status} para ${externalId} — asumimos activo`)
    return true

  } catch {
    // Error de red → asumir activo
    return true
  }
}

async function main() {
  console.log('🏆 HUNTPADEL — Top Oportunidades')
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  // ── 1. Leer candidatos de wallapop_cache ──────────────────────────────────
  console.log('📦 Leyendo wallapop_cache...')
  const { data: items, error } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, price, condition, platform, img, url, city, pala_id, marca')
    .in('condition', CONDICIONES_BUENAS)
    .gte('price', MIN_PRICE)

  if (error || !items) {
    console.error('❌ Error leyendo wallapop_cache:', error)
    process.exit(1)
  }

  console.log(`📊 ${items.length} anuncios en condición buena con precio > ${MIN_PRICE}€\n`)

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

  // ── 3. Calcular oportunidades brutas ──────────────────────────────────────
  const todasOportunidades: any[] = []

  for (const [, grupo] of grupos) {
    if (grupo.items.length < MIN_ITEMS_GRUPO) continue

    const precios = grupo.items.map(i => i.price)
    const med = mediana(precios)

    const oportunidades = grupo.items
      .filter(item => item.price < med * (1 - DESCUENTO_MIN / 100))
      .map(item => ({
        external_id:   item.external_id,
        title:         item.title,
        price:         item.price,
        precio_medio:  Math.round(med * 100) / 100,
        descuento_pct: Math.round(((med - item.price) / med) * 100),
        condition:     item.condition,
        platform:      item.platform,
        img:           item.img,
        url:           item.url,
        city:          item.city,
        keyword:       `${grupo.marca} ${grupo.modelo}`,
        pala_id:       item.pala_id,
      }))

    if (oportunidades.length > 0) {
      console.log(`  💎 ${grupo.marca} ${grupo.modelo}: mediana ${med}€, ${oportunidades.length} oportunidades`)
      todasOportunidades.push(...oportunidades)
    }
  }

  console.log(`\n📊 Total oportunidades brutas: ${todasOportunidades.length}`)

  // ── 4. Deduplicar y ordenar — lista completa de candidatos ───────────────
  const deduplicado = new Map<string, any>()
  for (const op of todasOportunidades) {
    const existing = deduplicado.get(op.external_id)
    if (!existing || op.descuento_pct > existing.descuento_pct) {
      deduplicado.set(op.external_id, op)
    }
  }

  // Todos los candidatos ordenados por descuento desc — elegiremos hasta TOP_N activos
  const candidatos = Array.from(deduplicado.values())
    .sort((a, b) => b.descuento_pct - a.descuento_pct)

  console.log(`📋 ${candidatos.length} candidatos únicos`)

  if (candidatos.length === 0) {
    console.log('⚠️  Sin candidatos — no se actualiza la tabla.')
    return
  }

  // ── 5. Verificar activos contra la API — rellenar hasta TOP_N ────────────
  //
  // Verificamos candidatos en orden hasta completar TOP_N activos.
  // Limitamos las llamadas a TOP_N * 3 como máximo para no agotar cuota
  // si hay muchos vendidos (indicaría un problema en el scrape).
  const maxVerificar = Math.min(candidatos.length, TOP_N * 3)
  console.log(`\n🔍 Verificando hasta ${maxVerificar} candidatos contra la API de Wallapop...\n`)

  const top: any[] = []
  const vendidosABorrar: string[] = []

  for (let i = 0; i < maxVerificar && top.length < TOP_N; i++) {
    const candidato = candidatos[i]

    // Los anuncios de Vinted no tienen este endpoint — los aceptamos directamente
    if (candidato.platform !== 'wallapop') {
      top.push(candidato)
      continue
    }

    process.stdout.write(`  [${i + 1}/${maxVerificar}] ${candidato.external_id} (${candidato.descuento_pct}% dto)... `)
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

  // ── 6. Limpiar de wallapop_cache los vendidos detectados ─────────────────
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

  // ── 7. Guardar el Top en la BD ────────────────────────────────────────────
  console.log(`\n🏆 Top ${top.length} final tras verificación:`)
  top.forEach((op, i) => {
    console.log(`  ${i + 1}. [${op.descuento_pct}%] ${op.title} — ${op.price}€ (mediana: ${op.precio_medio}€)`)
  })

  if (top.length === 0) {
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

  const now = new Date().toISOString()
  const { error: insertError } = await supabase
    .from('top_oportunidades')
    .insert(top.map(op => ({ ...op, updated_at: now })))

  if (insertError) {
    console.error('❌ Error insertando Top:', insertError)
    return
  }

  console.log(`\n✅ Top ${top.length} guardado en top_oportunidades.`)
  if (vendidosABorrar.length > 0) {
    console.log(`🧹 ${vendidosABorrar.length} anuncios vendidos eliminados de wallapop_cache de paso.`)
  }
  console.log('🏁 Top Oportunidades completado.\n')
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
