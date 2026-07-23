/**
 * scripts/refresh-wallapop-prices.ts
 * =============================================
 * Refresca precios de todos los items de wallapop_cache con last_seen_at > 6h.
 * Lo ejecuta el GitHub Action cada hora (independiente de la extensión).
 * Esto garantiza precios frescos aunque Chrome esté cerrado.
 *
 * Ejecutar manualmente:
 *   npx tsx --env-file=.env.local scripts/refresh-wallapop-prices.ts
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const BATCH_SIZE   = 10    // peticiones en paralelo
const THROTTLE_MS  = 150   // ms entre batches
const STALE_HOURS  = 6     // refresh items no vistos en más de 6h
const HEADERS      = { 'Accept': 'application/json', 'MPlatform': 'WEB', 'Accept-Language': 'es-ES' }

async function fetchItemPrice(externalId: string): Promise<{ price: number | null; sold: boolean }> {
  try {
    const res = await fetch(`https://api.wallapop.com/api/v3/items/${externalId}`, { headers: HEADERS })
    if (res.status === 404 || res.status === 410) return { price: null, sold: true }
    if (!res.ok) return { price: null, sold: false }
    const d = await res.json()
    // Vendido puede venir como flag en diferentes estructuras de respuesta
    const isSold = d?.flags?.sold === true
                || d?.sold?.flag   === true
                || d?.item?.flags?.sold === true
    if (isSold) return { price: null, sold: true }
    const price = d?.price?.cash?.amount ?? d?.item?.price?.cash?.amount ?? null
    return { price, sold: false }
  } catch {
    return { price: null, sold: false }
  }
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  const staleThreshold = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000).toISOString()

  const { data: items, error } = await supabase
    .from('wallapop_cache')
    .select('external_id, price')
    .eq('platform', 'wallapop')
    .lt('last_seen_at', staleThreshold)
    .order('last_seen_at', { ascending: true })

  if (error) {
    console.error('Error consultando wallapop_cache:', error)
    process.exit(1)
  }

  if (!items || items.length === 0) {
    console.log('✅ Todos los precios están frescos (nada con last_seen_at > 6h)')
    return
  }

  console.log(`🔄 Refrescando precios de ${items.length} anuncios (last_seen_at > ${STALE_HOURS}h)...`)

  let updated  = 0
  let deleted  = 0
  let errors   = 0
  let unchanged = 0
  const toDelete: string[] = []
  const now = new Date().toISOString()

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)

    await Promise.all(batch.map(async (item) => {
      const { price, sold } = await fetchItemPrice(item.external_id)

      if (sold) {
        toDelete.push(item.external_id)
        return
      }

      if (price === null) {
        errors++
        return
      }

      const pricioAnterior = Number(item.price)
      const updates: Record<string, unknown> = { last_seen_at: now }
      if (price !== pricioAnterior) {
        updates.price = price
        updated++
        console.log(`  💰 ${item.external_id}: ${pricioAnterior}€ → ${price}€`)
      } else {
        unchanged++
      }

      await supabase
        .from('wallapop_cache')
        .update(updates)
        .eq('external_id', item.external_id)
    }))

    // Progreso cada 100 items
    if ((i + BATCH_SIZE) % 100 === 0 || i + BATCH_SIZE >= items.length) {
      const done = Math.min(i + BATCH_SIZE, items.length)
      process.stdout.write(`  ${done}/${items.length}...\r`)
    }

    if (i + BATCH_SIZE < items.length) {
      await new Promise(r => setTimeout(r, THROTTLE_MS))
    }
  }

  // Borrar vendidos en bulk
  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from('wallapop_cache')
      .delete()
      .in('external_id', toDelete)
    if (!delErr) {
      deleted = toDelete.length
      console.log(`\n🗑️  Eliminados ${deleted} anuncios vendidos/retirados`)
    }
  }

  console.log(`\n✅ Refresh completado:`)
  console.log(`   - ${updated} precios actualizados`)
  console.log(`   - ${unchanged} sin cambio`)
  console.log(`   - ${deleted} eliminados (vendidos)`)
  console.log(`   - ${errors} errores de API (se reintentarán en próxima ejecución)`)
}

main().catch((err) => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
