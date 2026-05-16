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
 *  5. Deduplica por external_id, ordena por % descuento desc, Top 10
 *  6. Reemplaza COMPLETAMENTE top_oportunidades con el nuevo ranking
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

const CONDICIONES_BUENAS = ['new', 'un_opened', 'as_good_as_new']

const EXCLUIR_PALABRAS = [
  'junior', 'jr', 'infantil', 'niño', 'niña', 'reparada', 'reparado', 'dañada', 'dañado', 'rota', 'roto', 'golpe', 'paletero',
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
  // Quitar prefijos comunes
  const sinPrefijo = lower
    .replace(/^(pala de pádel|pala de padel|pala pádel|pala padel|raqueta de pádel|raqueta padel|pala|raqueta)\s+/i, '')
  // Quitar la marca
  const marcaLower = marca.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sinMarca = sinPrefijo.replace(new RegExp(marcaLower, 'i'), '').trim()
  // Coger las 2 primeras palabras
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

async function main() {
  console.log('🏆 HUNTPADEL — Top Oportunidades')
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  // Leer todos los anuncios en condición buena y precio > 30€
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

  // Filtrar accesorios y agrupar por marca+modelo
  const grupos = new Map<string, { items: CacheItem[], marca: string, modelo: string }>()

  for (const item of items as CacheItem[]) {
    const titleLower = item.title.toLowerCase()

    // Filtrar accesorios
    if (EXCLUIR_PALABRAS.some(p => titleLower.includes(p))) continue

    // Detectar marca (primero de la columna marca, si no del título)
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

  // Calcular oportunidades por grupo
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

  // Deduplicar por external_id — quedarse con el mayor descuento
  const deduplicado = new Map<string, any>()
  for (const op of todasOportunidades) {
    const existing = deduplicado.get(op.external_id)
    if (!existing || op.descuento_pct > existing.descuento_pct) {
      deduplicado.set(op.external_id, op)
    }
  }

  const top = Array.from(deduplicado.values())
    .sort((a, b) => b.descuento_pct - a.descuento_pct)
    .slice(0, TOP_N)

  console.log(`\n🏆 Top ${TOP_N} final:`)
  top.forEach((op, i) => {
    console.log(`  ${i + 1}. [${op.descuento_pct}%] ${op.title} — ${op.price}€ (mediana: ${op.precio_medio}€)`)
  })

  if (top.length === 0) {
    console.log('\n⚠️  Sin oportunidades — no se actualiza la tabla.')
    return
  }

  // Reemplazar completamente la tabla
  const { error: deleteError } = await supabase
    .from('top_oportunidades')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')

  if (deleteError) {
    console.error('❌ Error borrando tabla:', deleteError)
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
  console.log('🏁 Top Oportunidades completado.\n')
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
