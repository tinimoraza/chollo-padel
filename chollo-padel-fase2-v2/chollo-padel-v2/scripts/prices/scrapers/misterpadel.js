// scripts/prices/scrapers/misterpadel.js
// Mister Padel — Clerk.io API
// Clerk key: oViLXCkVp3oqPERmIdkGDadmGGSm9FA8
// API: https://api.clerk.io/v2/search/search?key=KEY&query=pala+padel&limit=100&offset=0
//      &attributes[]=name&attributes[]=price&attributes[]=list_price&attributes[]=url
//
// NOTA (fix 2026-06-18): la query "pala padel" en Clerk.io es búsqueda libre
// (fuzzy/recomendador), no un filtro de categoría — devolvía ropa y calzado
// (Asics/Nike faldas, mallas, zapatillas...) que disparó el sin-match al 93.9%.
// El campo "product_type" viene vacío en la mayoría de palas reales, así que no
// sirve como filtro. En cambio el campo "categories" (array de IDs numéricos)
// SÍ es fiable: el ID 1 = "Palas de padel" exclusivamente — verificado contra
// ~800 productos, 175 con categories.includes(1) y ninguno de ropa/calzado/
// accesorios lo tenía. Filtramos por esa categoría en vez de por palabras clave.

const SOURCE_KEY  = 'misterpadel'
const CLERK_KEY   = 'oViLXCkVp3oqPERmIdkGDadmGGSm9FA8'
const CAT_PALAS   = 1
const LIMIT       = 100
const MAX_ITEMS   = 2000

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla', 'shoe',
  'shirt', 'bag', 'string', 'net', 'ball', 'balls', 'accessory', 'calzado']

function esPala(p) {
  if (!Array.isArray(p.categories) || !p.categories.includes(CAT_PALAS)) return false
  const nl = (p.name || '').toLowerCase()
  return !EXCLUIR.some(w => nl.includes(w))
}

async function scrape() {
  console.log('[misterpadel] Iniciando scraper (Clerk.io API)…')

  const allProducts = []
  let offset = 0

  while (offset < MAX_ITEMS) {
    const url = `https://api.clerk.io/v2/search/search?key=${CLERK_KEY}&query=pala+padel&limit=${LIMIT}&offset=${offset}&attributes[]=name&attributes[]=price&attributes[]=list_price&attributes[]=url&attributes[]=categories`

    let data
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      data = await res.json()
    } catch (err) {
      console.error(`[misterpadel] Error en offset ${offset}:`, err.message)
      break
    }

    if (data.status !== 'ok' || !data.product_data?.length) break

    for (const p of data.product_data) {
      if (!p.name || !p.url || !p.price) continue
      if (!esPala(p)) continue
      const price    = parseFloat(p.price)
      const original = parseFloat(p.list_price)
      if (isNaN(price) || price < 30) continue
      allProducts.push({
        title:           p.name,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url:             p.url,
      })
    }

    console.log(`[misterpadel] offset=${offset} → ${data.product_data.length} productos (total acum: ${allProducts.length})`)

    if (data.product_data.length < LIMIT) break
    offset += LIMIT
  }

  // Deduplicar por URL
  const seen = new Set()
  const unique = allProducts.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[misterpadel] Total palas únicas: ${unique.length}`)
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
