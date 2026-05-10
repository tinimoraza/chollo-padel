/**
 * Test: ¿responde la API de Wallapop sin browser?
 * Ejecutar: npx tsx --env-file=.env.local scripts/test-api-directa.ts
 */

const HEADERS_MOVIL = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'User-Agent': 'Wallapop/67 CFNetwork/1410.0.3 Darwin/22.6.0',
  'X-AppVersion': '67.0.0',
  'X-Platform': 'ios',
  'DeviceOS': '1',
  'MPlatform': 'IOS',
}

async function test() {
  const params = new URLSearchParams({
    keywords:  'pala padel',
    latitude:  '40.4168',
    longitude: '-3.7038',
    order_by:  'newest',
    start:     '0',
    step:      '10',
  })

  const url = `https://api.wallapop.com/api/v3/general/search?${params}`
  console.log('🔍 Llamando a:', url)

  try {
    const res = await fetch(url, { headers: HEADERS_MOVIL })
    console.log('📡 Status:', res.status)

    if (!res.ok) {
      const text = await res.text()
      console.log('❌ Error body:', text.slice(0, 500))
      return
    }

    const data = await res.json()
    const items = data?.search_objects ?? data?.items ?? []
    console.log(`✅ Items recibidos: ${items.length}`)
    if (items.length > 0) {
      console.log('🏓 Primer item:', items[0].title, '—', items[0].sale_price, '€')
    }
  } catch (err) {
    console.error('💥 Error:', err)
  }
}

test()
