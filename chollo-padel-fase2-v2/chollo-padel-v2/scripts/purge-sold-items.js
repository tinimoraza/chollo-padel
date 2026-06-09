/**
 * scripts/purge-sold-items.js
 * Barrido masivo de anuncios vendidos/eliminados en Wallapop y Vinted.
 *
 * Uso:
 *   node scripts/purge-sold-items.js          → ambas plataformas
 *   node scripts/purge-sold-items.js vinted    → solo Vinted
 *   node scripts/purge-sold-items.js wallapop  → solo Wallapop
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
)

const CONCURRENCY = 20  // peticiones simultáneas
const platform = process.argv[2] ?? 'all'

// ── Vinted ───────────────────────────────────────────────────────────────────

let vintedAuth = null

async function getVintedToken() {
  if (vintedAuth) return vintedAuth
  const res = await fetch('https://www.vinted.es', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
  })
  const rawCookies = res.headers.getSetCookie?.() ?? []
  const cookie = rawCookies.map(c => c.split(';')[0]).filter(c => {
    const [, val] = c.split('=')
    return val && val.trim().length > 0
  }).join('; ')
  const tokenEntry = rawCookies.map(c => c.split(';')[0])
    .find(c => c.startsWith('access_token_web=') && c.length > 'access_token_web='.length + 5)
  const token = tokenEntry?.split('=').slice(1).join('=')
  if (!token) throw new Error('No se pudo obtener token de Vinted')
  vintedAuth = { cookie, token }
  return vintedAuth
}

async function isVintedActive(externalId, auth) {
  const vintedId = externalId.replace('vinted_', '')
  try {
    const res = await fetch(`https://www.vinted.es/api/v2/items/${vintedId}`, {
      headers: {
        'Accept': 'application/json',
        'Cookie': auth.cookie,
        'Authorization': `Bearer ${auth.token}`,
      },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 404 || res.status === 410) return false
    if (!res.ok) return true
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) return false
    const data = await res.json()
    if (!data?.item) return false
    const item = data.item
    if (item.can_be_sold === false) return false
    if (item.is_visible === false || item.is_visible === 0) return false
    if (typeof item.status === 'number' && item.status !== 0) return false
    return true
  } catch {
    return true // timeout → conservar
  }
}

// ── Wallapop ─────────────────────────────────────────────────────────────────

async function isWallapopActive(externalId) {
  try {
    const res = await fetch(`https://api.wallapop.com/api/v3/items/${externalId}`, {
      headers: { 'Accept': 'application/json', 'MPlatform': 'WEB', 'Accept-Language': 'es-ES' },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 404 || res.status === 410) return false
    if (!res.ok) return true
    const data = await res.json()
    const isSold     = data?.sold?.flag === true || data?.item?.flags?.sold === true
    const isReserved = data?.reserved?.flag === true || data?.item?.flags?.reserved === true
    return !isSold && !isReserved
  } catch {
    return true // timeout → conservar
  }
}

// ── Barrido en paralelo ───────────────────────────────────────────────────────

async function runInParallel(items, checkFn, label) {
  const toDelete = []
  let done = 0
  const total = items.length

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (item) => {
        const active = await checkFn(item.external_id)
        return { external_id: item.external_id, active }
      })
    )
    for (const r of results) {
      if (!r.active) toDelete.push(r.external_id)
    }
    done += batch.length
    process.stdout.write(`\r  [${label}] ${done}/${total} verificados — ${toDelete.length} a eliminar`)
  }
  console.log()
  return toDelete
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function purge(plt) {
  console.log(`\n🔍 Cargando items de ${plt} desde BD...`)
  const items = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('wallapop_cache')
      .select('external_id')
      .eq('platform', plt)
      .range(from, from + PAGE - 1)
    if (error) { console.error('Error:', error); return }
    if (!data || data.length === 0) break
    items.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  console.log(`  → ${items.length} items`)

  let toDelete = []

  if (plt === 'vinted') {
    console.log('🔑 Obteniendo token Vinted...')
    const auth = await getVintedToken()
    console.log('✅ Token OK')
    toDelete = await runInParallel(items, (id) => isVintedActive(id, auth), 'Vinted')
  } else {
    toDelete = await runInParallel(items, isWallapopActive, 'Wallapop')
  }

  if (toDelete.length === 0) {
    console.log(`  ✅ Ninguno vendido/eliminado en ${plt}`)
    return
  }

  console.log(`\n🗑️  Eliminando ${toDelete.length} items de ${plt}...`)
  const BATCH = 200
  let deleted = 0
  for (let i = 0; i < toDelete.length; i += BATCH) {
    const chunk = toDelete.slice(i, i + BATCH)
    const { error: delErr } = await supabase
      .from('wallapop_cache')
      .delete()
      .in('external_id', chunk)
    if (!delErr) deleted += chunk.length
    else console.error('Error borrando batch:', delErr)
  }
  console.log(`  ✅ Eliminados ${deleted} items de ${plt}`)
}

async function main() {
  const start = Date.now()
  const platforms = platform === 'all' ? ['vinted', 'wallapop'] : [platform]
  for (const plt of platforms) {
    await purge(plt)
  }
  const secs = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\n✅ Barrido completado en ${secs}s`)
}

main().catch(err => { console.error('💥', err); process.exit(1) })
