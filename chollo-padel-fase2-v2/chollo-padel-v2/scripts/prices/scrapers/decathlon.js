// scripts/prices/scrapers/decathlon.js
// Scraper Decathlon ES — API JSON (no necesita Playwright)
// Usa el endpoint interno de Decathlon que devuelve productos paginados.

const https      = require('https')
const SOURCE_KEY = 'decathlon'

// Endpoint de búsqueda de Decathlon ES para palas de pádel
// Filtra por categoría 2614 (Palas de pádel) o usa keyword "pala padel"
const API_URL = 'https://www.decathlon.es/api/products/search?page={PAGE}&resultsPerPage=60&query=pala+padel&typeSearch=PRODUCT'

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':          'application/json',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Referer':         'https://www.decathlon.es/',
      },
    }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (e) { reject(new Error('JSON parse error: ' + e.message)) }
      })
    })
    req.on('error', reject)
    req.setTimeout(20_000, () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function scrape() {
  console.log('[decathlon] Iniciando scraper (API JSON)…')

  const allProducts = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    const url = API_URL.replace('{PAGE}', page - 1)  // Decathlon usa offset 0-based
    console.log(`[decathlon] Página ${page}/${totalPages}…`)

    let data
    try {
      data = await httpGet(url)
    } catch (err) {
      console.error(`[decathlon] Error página ${page}: ${err.message}`)
      break
    }

    // La respuesta puede venir en diferentes formatos según versión de API
    const products = data?.products ?? data?.data?.products ?? data?.hits ?? []
    const total    = data?.total ?? data?.data?.total ?? data?.nbHits ?? 0

    if (page === 1) {
      totalPages = Math.ceil(total / 60) || 1
      console.log(`[decathlon] ${total} productos en ${totalPages} páginas`)
    }

    for (const p of products) {
      // Filtrar solo palas de pádel (categoría o nombre)
      const title = p.title ?? p.name ?? ''
      if (!title) continue
      const titleLower = title.toLowerCase()
      // Excluir pelotas, zapatillas, bolsas, etc.
      if (!titleLower.includes('pala') && !titleLower.includes('raqueta')) continue

      const price = parseFloat(p.price?.value ?? p.price ?? p.currentPrice ?? 0)
      if (!price || isNaN(price) || price <= 0) continue

      const original = parseFloat(p.price?.originalValue ?? p.crossedOutPrice ?? 0)
      const slug = p.slug ?? p.modelCode ?? p.id
      if (!slug || slug === 'undefined') continue  // evitar URL basura tipo /es/p/undefined/12345
      const url  = `https://www.decathlon.es/es/p/${slug}/${p.id ?? ''}`.replace(/\/$/, '')
      if (!url) continue

      allProducts.push({
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url,
      })
    }

    if (page >= totalPages) break
    page++
    await sleep(800)
  }

  // Deduplicar por URL
  const seen   = new Set()
  const unique = allProducts.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[decathlon] Total palas: ${unique.length}`)
  const scraped_at = new Date().toISOString()
  return unique.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    scraped_at,
  }))
}

module.exports = { scrape, SOURCE_KEY }
