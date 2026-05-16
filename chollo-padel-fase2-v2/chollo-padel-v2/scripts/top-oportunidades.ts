/**
 * scripts/top-oportunidades.ts
 * ===========================================
 * Genera el Top 10 global de oportunidades de segunda mano.
 * Lo ejecuta GitHub Actions cada hora.
 *
 * Lógica:
 *  1. Para cada KEYWORD, busca en wallapop_cache items new/as_good_as_new/un_opened
 *  2. Calcula el precio medio de esa keyword
 *  3. Marca como oportunidad los que están ≥25% por debajo del precio medio
 *  4. Recoge todas las oportunidades de todas las keywords, deduplica por external_id
 *  5. Ordena por % de descuento desc, se queda con el Top 10
 *  6. Reemplaza COMPLETAMENTE top_oportunidades con el nuevo ranking
 *
 * Ejecutar manualmente:
 *   npx tsx --env-file=.env.local scripts/top-oportunidades.ts
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

// Keywords a buscar — las mismas que el scraper para máxima cobertura
const KEYWORDS = [
  'bullpadel',
  'babolat padel',
  'nox padel',
  'head padel',
  'wilson padel',
  'adidas padel',
]

// Condiciones que consideramos "nuevo / como nuevo"
const CONDICIONES_BUENAS = new Set([
  'new',
  'un_opened',
  'as_good_as_new',
])

const MIN_PRICE        = 30    // Ignorar anuncios por debajo de 30€ (accesorios, grips...)

// Palabras en el título que indican que NO es una pala
const EXCLUIR_PALABRAS = [
  'bolsa', 'paletero', 'mochila', 'zapatilla', 'zapatillas',
  'funda', 'grip', 'bolas', 'pelota', 'pelotas', 'ropa',
  'camiseta', 'muñequera', 'overgrip', 'protector', 'antivibrador',
]
const MIN_ITEMS_MEDIA  = 5     // Mínimo de anuncios para calcular precio medio fiable
const DESCUENTO_MIN    = 25    // % mínimo de descuento para ser oportunidad
const TOP_N            = 10    // Tamaño del ranking

interface CacheItem {
  external_id:  string
  title:        string
  price:        number
  condition:    string
  platform:     string
  img:          string | null
  url:          string
  city:         string | null
  pala_id:      string | null
  keyword:      string | null
}

interface Oportunidad {
  external_id:   string
  title:         string
  price:         number
  precio_medio:  number
  descuento_pct: number
  condition:     string
  platform:      string
  img:           string | null
  url:           string
  city:          string | null
  keyword:       string
  pala_id:       string | null
}

async function main() {
  console.log('🏆 HUNTPADEL — Top Oportunidades')
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  const todasOportunidades: Oportunidad[] = []

  for (const keyword of KEYWORDS) {
    console.log(`🔍 Procesando keyword: "${keyword}"`)

    const words = keyword.toLowerCase().split(/\s+/).filter(Boolean)

    // Buscar en wallapop_cache todos los anuncios de esta keyword
    // en condición buena y precio mínimo
    let query = supabase
      .from('wallapop_cache')
      .select('external_id, title, price, condition, platform, img, url, city, pala_id, keyword')
      .in('condition', Array.from(CONDICIONES_BUENAS))
      .gte('price', MIN_PRICE)
      .order('price', { ascending: true })
      .limit(500)

    for (const word of words) {
      query = query.ilike('title', `%${word}%`)
    }

    const { data: items, error } = await query

    if (error || !items || items.length === 0) {
      console.log(`  ⚠️  Sin resultados o error para "${keyword}"`)
      continue
    }

    // Filtrar accesorios (bolsas, paleteros, mochilas...)
    const soloParas = items.filter((item: CacheItem) => {
      const t = item.title.toLowerCase()
      return !EXCLUIR_PALABRAS.some(palabra => t.includes(palabra))
    })
    console.log(`  📦 ${items.length} anuncios → ${soloParas.length} tras filtrar accesorios`)
    const itemsFiltrados = soloParas

    // Calcular precio medio
    if (itemsFiltrados.length < MIN_ITEMS_MEDIA) {
      console.log(`  ⚠️  Menos de ${MIN_ITEMS_MEDIA} anuncios tras filtrar — saltando`)
      continue
    }

    const precios  = itemsFiltrados.map((i: CacheItem) => i.price)
    const media    = precios.reduce((a: number, b: number) => a + b, 0) / precios.length
    const precioMedio = Math.round(media * 100) / 100

    console.log(`  💰 Precio medio: ${precioMedio}€ (sobre ${itemsFiltrados.length} anuncios)`)

    // Detectar oportunidades
    const oportunidadesKeyword = itemsFiltrados
      .filter((item: CacheItem) => {
        const descuento = ((precioMedio - item.price) / precioMedio) * 100
        return descuento >= DESCUENTO_MIN
      })
      .map((item: CacheItem) => {
        const descuento_pct = Math.round(((precioMedio - item.price) / precioMedio) * 100)
        return {
          external_id:   item.external_id,
          title:         item.title,
          price:         item.price,
          precio_medio:  precioMedio,
          descuento_pct,
          condition:     item.condition,
          platform:      item.platform,
          img:           item.img,
          url:           item.url,
          city:          item.city,
          keyword,
          pala_id:       item.pala_id,
        }
      })

    console.log(`  💎 ${oportunidadesKeyword.length} oportunidades (≥${DESCUENTO_MIN}% descuento)`)
    todasOportunidades.push(...oportunidadesKeyword)
  }

  console.log(`\n📊 Total oportunidades brutas: ${todasOportunidades.length}`)

  // Deduplicar por external_id (un anuncio puede aparecer en múltiples keywords)
  // Nos quedamos con el que tenga mayor % de descuento
  const deduplicado = new Map<string, Oportunidad>()
  for (const op of todasOportunidades) {
    const existing = deduplicado.get(op.external_id)
    if (!existing || op.descuento_pct > existing.descuento_pct) {
      deduplicado.set(op.external_id, op)
    }
  }

  // Ordenar por descuento desc y coger el Top N
  const top = Array.from(deduplicado.values())
    .sort((a, b) => b.descuento_pct - a.descuento_pct)
    .slice(0, TOP_N)

  console.log(`🏆 Top ${TOP_N} final:`)
  top.forEach((op, i) => {
    console.log(`  ${i + 1}. [${op.descuento_pct}%] ${op.title} — ${op.price}€ (medio: ${op.precio_medio}€)`)
  })

  if (top.length === 0) {
    console.log('\n⚠️  Sin oportunidades — no se actualiza la tabla.')
    return
  }

  // Reemplazar COMPLETAMENTE la tabla con el nuevo Top 10
  // Primero borramos todo, luego insertamos
  const { error: deleteError } = await supabase
    .from('top_oportunidades')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000') // truco para borrar todas las filas

  if (deleteError) {
    console.error('❌ Error borrando tabla:', deleteError)
    return
  }

  const now = new Date().toISOString()
  const rows = top.map(op => ({ ...op, updated_at: now }))

  const { error: insertError } = await supabase
    .from('top_oportunidades')
    .insert(rows)

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
