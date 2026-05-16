/**
 * scripts/scrape-vinted.ts
 * ===========================================
 * Scraper de Vinted usando la API pública.
 * Lo ejecuta GitHub Actions cada hora.
 * Guarda los resultados en Supabase tabla wallapop_cache con platform='vinted'.
 *
 * Ejecutar manualmente:
 *   npx tsx --env-file=.env.local scripts/scrape-vinted.ts
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const KEYWORDS = [
  'pala padel',
  'pala babolat',
  'pala nox padel',
  'pala head padel',
  'pala wilson padel',
  'pala bullpadel',
]

const CONDITION_MAP_REVERSE: Record<string, string> = {
  '6': 'new',            // Vinted: "Nuevo con etiquetas" -> nuevo
  '1': 'as_good_as_new', // Vinted: "Nuevo sin etiquetas" -> como nuevo
  '2': 'good',           // Vinted: "Muy bueno"           -> buen estado
  '3': 'fair',           // Vinted: "Bueno"               -> aceptable
  '4': 'fair',           // Vinted: "Satisfactorio"       -> aceptable
}

// ── Token Vinted ────────────────────────────────────────────────────────────

let cachedAuth: { cookie: string; token: string; expiresAt: number } | null = null

async function getVintedToken(): Promise<{ cookie: string; token: string } | null> {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) {
    return { cookie: cachedAuth.cookie, token: cachedAuth.token }
  }
  try {
    const res = await fetch('https://www.vinted.es', {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
    })

    const rawCookies = res.headers.getSetCookie?.() ?? []
    const cookie = rawCookies.map(c => c.split(';')[0]).filter(c => {
      const [, val] = c.split('=')
      return val && val.trim().length > 0
    }).join('; ')

    const tokenEntry = rawCookies
      .map(c => c.split(';')[0])
      .find(c => c.startsWith('access_token_web=') && c.length > 'access_token_web='.length + 5)

    const token = tokenEntry?.split('=').slice(1).join('=')
    if (!token) return null

    cachedAuth = { cookie, token, expiresAt: Date.now() + 5 * 60 * 1000 }
    return { cookie, token }
  } catch (err) {
    console.error('Error obteniendo token de Vinted:', err)
    return null
  }
}

// ── Búsqueda ────────────────────────────────────────────────────────────────

async function scrapeKeyword(keyword: string, auth: { cookie: string; token: string }) {
  const params = new URLSearchParams({
    search_text: keyword,
    per_page:    '120',
    order:       'newest_first',
  })

  try {
    const res = await fetch(`https://www.vinted.es/api/v2/catalog/items?${params}`, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Referer':         'https://www.vinted.es/',
        'Cookie':          auth.cookie,
        'Authorization':   `Bearer ${auth.token}`,
      },
    })

    if (!res.ok) {
      console.error(`  ❌ HTTP ${res.status} para "${keyword}"`)
      return []
    }

    const data = await res.json()
    const items: any[] = data.items ?? []
    console.log(`  ✅ "${keyword}": ${items.length} items`)

    const words = keyword.toLowerCase().split(/\s+/).filter(Boolean)

    return items
      .filter(item => {
        const titleLower = (item.title ?? '').toLowerCase()
        return words.every(w => titleLower.includes(w))
      })
      .map(item => {
        const img = item.photo?.url ?? item.photos?.[0]?.url ?? null
        const ts  = item.photo?.high_resolution?.timestamp
        const date = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString()
        const price = parseFloat(item.price?.amount ?? '0')
        const conditionId = String(item.status ?? '')
        const condition = CONDITION_MAP_REVERSE[conditionId] ?? conditionId

        return {
          external_id: `vinted_${item.id}`,
          title:       item.title ?? '',
          price,
          currency:    item.price?.currency_code ?? 'EUR',
          condition,
          img,
          url:         item.url ?? `https://www.vinted.es/items/${item.id}`,
          city:        'Europa',
          date,
          keyword,
          platform:    'vinted',
        }
      })
  } catch (err) {
    console.error(`  ❌ Error en "${keyword}":`, err)
    return []
  }
}

// ── Verificar anuncio Vinted activo ─────────────────────────────────────────

async function isVintedItemActive(externalId: string, auth: { cookie: string; token: string }): Promise<boolean> {
  // external_id es "vinted_12345" — extraemos el ID numérico
  const vintedId = externalId.replace('vinted_', '')
  try {
    const res = await fetch(`https://www.vinted.es/api/v2/items/${vintedId}`, {
      headers: {
        'Accept':        'application/json',
        'Cookie':        auth.cookie,
        'Authorization': `Bearer ${auth.token}`,
      },
    })
    if (res.status === 404) return false
    if (!res.ok) return true // Si falla por otro motivo, lo dejamos
    const data = await res.json()
    return data?.item?.can_be_sold !== false
  } catch {
    return true // Si falla la verificación, dejamos el anuncio
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🏓 HUNTPADEL — Scraper Vinted')
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  console.log('🔑 Obteniendo token de Vinted...')
  const auth = await getVintedToken()
  if (!auth) {
    console.error('💥 No se pudo obtener token. Abortando.')
    process.exit(1)
  }
  console.log('✅ Token obtenido\n')

  const allItems: any[] = []

  for (const keyword of KEYWORDS) {
    console.log(`🔍 Buscando: "${keyword}"`)
    const items = await scrapeKeyword(keyword, auth)
    allItems.push(...items)
    await new Promise(r => setTimeout(r, 1500))
  }

  console.log(`\n📊 Total items scrapeados: ${allItems.length}`)

  if (allItems.length === 0) {
    console.log('⚠️  Sin resultados, abortando upsert.')
    return
  }

  const seen = new Set<string>()
  const unique = allItems.filter(item => {
    if (!item.external_id || seen.has(item.external_id)) return false
    seen.add(item.external_id)
    return true
  })

  console.log(`📊 Items únicos: ${unique.length}`)

  const now = new Date().toISOString()
  const BATCH = 100
  let inserted = 0

  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH).map(item => ({
      ...item,
      scraped_at:   now,
      last_seen_at: now,
    }))

    const { error } = await supabase
      .from('wallapop_cache')
      .upsert(batch, { onConflict: 'external_id', ignoreDuplicates: false })

    if (error) {
      console.error(`❌ Error en upsert batch ${i / BATCH + 1}:`, error)
    } else {
      inserted += batch.length
    }
  }

  // ── Verificar anuncios Vinted que llevan 7+ días sin aparecer ──
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: stale, error: staleError } = await supabase
    .from('wallapop_cache')
    .select('external_id')
    .eq('platform', 'vinted')
    .lt('last_seen_at', sevenDaysAgo)

  if (!staleError && stale && stale.length > 0) {
    console.log(`\n🔍 Verificando ${stale.length} anuncios Vinted sin actividad en 7+ días...`)
    const toDelete: string[] = []

    for (const item of stale) {
      const active = await isVintedItemActive(item.external_id, auth)
      if (!active) toDelete.push(item.external_id)
      await new Promise(r => setTimeout(r, 300)) // throttle
    }

    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from('wallapop_cache')
        .delete()
        .in('external_id', toDelete)
      if (!delErr) console.log(`🗑️  Eliminados ${toDelete.length} anuncios vendidos/eliminados`)
    } else {
      console.log('✅ Todos siguen activos')
    }
  }

  // ── Borrar anuncios Vinted con más de 30 días sin actividad ──
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { error: deleteError } = await supabase
    .from('wallapop_cache')
    .delete()
    .eq('platform', 'vinted')
    .lt('last_seen_at', thirtyDaysAgo)

  if (deleteError) {
    console.error('⚠️  Error borrando registros viejos:', deleteError)
  }

  console.log(`\n✅ Guardados ${inserted} items en Supabase.`)
  console.log('🏁 Scraper Vinted completado.\n')
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
