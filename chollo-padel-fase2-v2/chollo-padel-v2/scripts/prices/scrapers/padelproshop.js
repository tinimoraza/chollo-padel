// scripts/prices/scrapers/padelproshop.js
// v10 (2026-05-29): Section API + parser corregido (data-hover-title en línea separada)

const SOURCE_KEY = 'padelproshop'
const BASE_URL   = 'https://padelproshop.com/collections/palas-padel'
const SECTION_ID = 'template--26596133339441__main'
const DELAY_MS   = 600

const { detectarCodigoDescuento } = require('./_discount-utils.js')

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function extractFromHtml(html) {
  const items = []
  const seen  = new Set()

  // Dividir el HTML en bloques de product-card
  const chunks = html.split('<product-card')
  chunks.shift() // quitar el trozo anterior al primer <product-card

  for (const chunk of chunks) {
    // Título
    const titleMatch = chunk.match(/data-hover-title="([^"]+)"/)
    if (!titleMatch) continue
    const title = titleMatch[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim()

    // URL (quitar variant)
    const hrefMatch = chunk.match(/href="(\/products\/[^"?]+)/)
    if (!hrefMatch) continue
    const url = 'https://padelproshop.com' + hrefMatch[1]
    if (seen.has(url)) continue
    seen.add(url)

    // Buscar todos los precios en el chunk (formato "164,95€" o "164.95€")
    const priceStrs = chunk.match(/[\d]+[,.]?\d*\s*€/g) || []
    const prices = priceStrs
      .map(s => parseFloat(s.replace(/[^\d,]/g, '').replace(',', '.')))
      .filter(n => !isNaN(n) && n >= 40 && n <= 2000)  // rango de precio de pala — evita capturar "Ahorra 30€" o "Envío 5€"

    if (prices.length === 0) continue

    const price    = Math.min(...prices)
    const maxPrice = Math.max(...prices)
    const original = maxPrice > price ? maxPrice : null

    // Imagen — Shopify CDN, buscamos la primera url de imagen del chunk (src o srcset)
    const imgMatch = chunk.match(/(?:\/\/|https:\/\/)cdn\.shopify\.com\/[^"'\s]+\.(?:jpg|jpeg|png|webp)[^"'\s]*/i)
    let image = imgMatch ? imgMatch[0] : null
    if (image && image.startsWith('//')) image = `https:${image}`

    items.push({ title, price, precio_original: original, url, image })
  }

  return items
}

async function scrape() {
  console.log('[padelproshop] Iniciando scraper (Section API v10)…')

  const allProducts = []
  const seen        = new Set()
  let page          = 1
  let codigoDescuento = null

  while (true) {
    const url = `${BASE_URL}?page=${page}&section_id=${SECTION_ID}`
    console.log(`[padelproshop] Página ${page}`)

    let html
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept':          'text/html',
          'Accept-Language': 'es-ES,es;q=0.9',
          'Referer':         page > 1 ? `${BASE_URL}?page=${page - 1}` : BASE_URL,
        },
      })
      if (!res.ok) { console.error(`[padelproshop] HTTP ${res.status}`); break }
      html = await res.text()
    } catch (err) {
      console.error(`[padelproshop] Error:`, err.message)
      break
    }

    if (page === 1) {
      codigoDescuento = detectarCodigoDescuento(html)
      if (codigoDescuento) {
        console.log(`[padelproshop] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
      }
    }

    const products = extractFromHtml(html)
    console.log(`[padelproshop]  → ${products.length} productos`)

    if (products.length === 0) break

    let added = 0
    for (const p of products) {
      if (!seen.has(p.url)) {
        seen.add(p.url)
        allProducts.push(p)
        added++
      }
    }

    if (added === 0) break

    page++
    await sleep(DELAY_MS)
  }

  console.log(`[padelproshop] Total palas únicas: ${allProducts.length}`)

  const scraped_at = new Date().toISOString()
  const resultado = allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    image:           p.image ?? null,
    scraped_at,
  }))
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
