// scripts/prices/scrapers/originalpadel.js
// Original Padel — OpenCart (tema Journal3), fetch + cheerio
// URL: https://originalpadel.com/es/palas-de-padel/
// Paginación: /page/N/?sort=p.date_added&order=DESC&limit=100
// 866 productos en 9 páginas con limit=100

const SOURCE_KEY = 'originalpadel'
const BASE_URL   = 'https://originalpadel.com'
const CAT_PATH   = '/es/palas-de-padel'
const LIMIT      = 100
const DELAY_MS   = 800
const MAX_PAGES  = 20

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Language': 'es-ES,es;q=0.9',
}

// NOTA (fix 2026-06-19): el catálogo de originalpadel mezcla ropa con palas
// (sudaderas, pantalones, mallas, boxers, polos…) que no estaban en EXCLUIR y
// caían como "sin match" al pasar por el extractor de atributos de palas.
// Confirmado en pipeline_run_20260618_230627.json (ej. "Sudadera Bullpadel
// Baiona Carbon", "Pantalon Bullpadel Beariz Negro", "Mallas Bullpadel Betan
// Negro", "Boxers Lacoste…"). Se amplía la lista de exclusión.
const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla',
  'gafas', 'libro', 'kit ', ' kit', 'sudadera', 'pantalon', 'pantalón',
  'malla', 'mallas', 'boxer', 'boxers', 'polo ', 'chaqueta', 'gorra',
  'sombrero', 'calcetin', 'calcetín', 'calcetines', 'leggin', 'sujetador',
  'top deportivo', 'chandal', 'chándal']

function isPala(title) {
  const t = title.toLowerCase()
  // Excluir packs que no son palas individuales (pack con x10, gafas, libros…)
  // pero conservar "pack pala X" que sí es una pala individual con paletero
  if (/pack.+(x\d+|gafas|libro|camiseta)/i.test(t)) return false
  return !EXCLUIR.some(w => t.includes(w))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function parsePrice(text) {
  if (!text) return NaN
  // Formato: "178.47€" o "178,47€"
  const m = text.match(/([\d,.]+)/)
  if (!m) return NaN
  return parseFloat(m[1].replace(',', '.'))
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function pageUrl(page) {
  if (page === 1) return `${BASE_URL}${CAT_PATH}/?sort=p.date_added&order=DESC&limit=${LIMIT}`
  return `${BASE_URL}${CAT_PATH}/page/${page}/?sort=p.date_added&order=DESC&limit=${LIMIT}`
}

async function scrape() {
  console.log('[originalpadel] Iniciando scraper (OpenCart Journal3, fetch + cheerio)…')

  let cheerio
  try { cheerio = require('cheerio') } catch {
    console.error('[originalpadel] cheerio no instalado'); return []
  }

  const allProducts = []
  const seen = new Set()
  let page = 1
  let lastPage = 1

  while (page <= MAX_PAGES) {
    const url = pageUrl(page)
    let html
    try { html = await fetchPage(url) }
    catch (e) { console.error(`[originalpadel] Error ${url}:`, e.message); break }

    const $ = cheerio.load(html)
    const cards = $('div.product-layout')
    if (cards.length === 0) break

    // Detectar última página desde paginación OpenCart
    if (page === 1) {
      $('.pagination a').each((_, a) => {
        const href = $(a).attr('href') || ''
        const m = href.match(/\/page\/(\d+)\//)
        if (m) {
          const n = parseInt(m[1])
          if (!isNaN(n) && n > lastPage) lastPage = n
        }
      })
      // También desde el texto "Mostrando X a Y de Z (N Páginas)"
      const paginaText = $('.pagination-results').text()
      const mPag = paginaText.match(/\((\d+)\s+P[áa]ginas?\)/)
      if (mPag) {
        const n = parseInt(mPag[1])
        if (!isNaN(n) && n > lastPage) lastPage = n
      }
      console.log(`[originalpadel] Total páginas: ${lastPage}`)
    }

    cards.each((_, el) => {
      const $c = $(el)

      // Título y URL — OpenCart Journal3: div.name > a
      const linkEl = $c.find('div.name a').first()
      const title  = linkEl.text().trim()
      let   href   = linkEl.attr('href') || ''

      // Algunos productos rotos tienen href con ?product_id= en vez de slug — los descartamos
      if (!title || !href || href.includes('?product_id=') || !isPala(title)) return

      // Limpiar query params del href (vienen con ?sort=... &order=... &limit=...)
      try { href = new URL(href).pathname.replace(/\/$/, '') + '/' } catch { /* mantener tal cual */ }
      // Si la URL ya es absoluta la dejamos; si es relativa la completamos
      if (!href.startsWith('http')) href = BASE_URL + href

      if (seen.has(href)) return
      seen.add(href)

      // Precio — dos casos:
      // 1. Producto en oferta: <span class="price-new">178.47€</span> <span class="price-old">198.35€</span>
      // 2. Precio normal:      <span class="price-normal">159.95€</span>
      const priceNew  = parsePrice($c.find('span.price-new').first().text())
      const priceNorm = parsePrice($c.find('span.price-normal').first().text())
      const priceOld  = parsePrice($c.find('span.price-old').first().text())

      const price    = !isNaN(priceNew) ? priceNew : priceNorm
      const original = (!isNaN(priceOld) && priceOld > price) ? priceOld : null

      if (isNaN(price) || price < 30) return

      // Imagen — img.img-first tiene src directo (no lazy load en OpenCart Journal3)
      const imgEl  = $c.find('img.img-first').first()
      const rawImg = imgEl.attr('src') || ''
      const image  = rawImg || null

      allProducts.push({ title, price, precio_original: original, url: href, image })
    })

    console.log(`[originalpadel] página ${page}/${lastPage} → ${cards.length} cards, ${allProducts.length} acumuladas`)

    if (page >= lastPage) break
    page++
    await sleep(DELAY_MS)
  }

  console.log(`[originalpadel] Total palas: ${allProducts.length}`)
  const scraped_at = new Date().toISOString()
  return allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    image:           p.image ?? null,
    scraped_at,
  }))
}

module.exports = { scrape, SOURCE_KEY }
