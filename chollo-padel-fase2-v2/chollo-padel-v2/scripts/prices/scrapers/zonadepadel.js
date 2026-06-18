// scripts/prices/scrapers/zonadepadel.js
// PrestaShop — fetch + cheerio
// Categoría principal /3-palas-de-padel muestra solo destacados (47)
// El catálogo completo está en subcategorías por marca con paginación ?page=N

const SOURCE_KEY = 'zonadepadel'
const BASE_URL   = 'https://www.zonadepadel.es'
const DELAY_MS   = 600

// Subcategorías de marca (excluimos nivel/tipo para evitar duplicados)
const BRAND_CATS = [
  '/35-palas-de-padel-adidas',
  '/97-palas-de-padel-babolat',
  '/92-palas-de-padel-black-crown',
  '/4-palas-de-padel-bullpadel-',
  '/163-palas-de-padel-lok',
  '/28-palas-de-padel-enebe',
  '/148-palas-de-padel-dreampadel',
  '/156-palas-de-padel-siux',
  '/5-palas-de-padel-drop-shot',
  '/33-palas-de-padel-star-vie',
  '/6-palas-de-padel-dunlop',
  '/174-palas-de-padel-tecnifibre',
  '/27-palas-de-padel-head',
  '/46-palas-de-padel-vibora',
  '/139-palas-de-padel-joma',
  '/36-palas-de-padel-wilson',
  '/8-palas-de-padel-royal-padel',
  '/30-palas-de-padel-nox',
]

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function parsePrice(text) {
  if (!text) return NaN
  const m = text.match(/([\d.]+,\d{2})/)
  if (!m) return NaN
  return parseFloat(m[1].replace('.', '').replace(',', '.'))
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

const TIENE_AÑO_RE = /\b(19|20)\d{2}\b/

// Algunos listados de zonadepadel mantienen el título "histórico" de un producto
// sin año (ej. "Head Speed Pro") aunque la ficha tenga varias ediciones por año
// en el catálogo (2023, 2025...). Sin año, pipeline-tiendas.ts no puede desambiguar
// y termina emparejando con la edición más reciente (falso positivo, ver caso real:
// "Head Speed Pro" → matcheó con la edición 2025 cuando la tienda vendía la 2023).
// Para evitarlo, si el título no trae año, vamos a la ficha de producto y lo extraemos
// de ahí (sale en el <title>, en la tabla de características "Año" y en el cuerpo).
async function extraerAñoDeFicha($) {
  const titleText = $('title').text()
  const mTitle = titleText.match(/\b(20\d{2})\b/)
  if (mTitle) return mTitle[1]

  let año = null
  $('dt').each((_, dt) => {
    if (año) return
    const label = $(dt).text().trim().toLowerCase()
    if (label === 'año' || label === 'ano') {
      const val = $(dt).next('dd').text().trim()
      const m = val.match(/(20\d{2})/)
      if (m) año = m[1]
    }
  })
  if (año) return año

  const bodyText = $('body').text()
  const mBody = bodyText.match(/a[nñ]o:?\s*(20\d{2})/i)
  return mBody ? mBody[1] : null
}

async function completarAñoSiFalta(load, products) {
  for (const p of products) {
    if (TIENE_AÑO_RE.test(p.title)) continue
    try {
      const html = await fetchPage(p.url)
      const año = await extraerAñoDeFicha(load(html))
      if (año) p.title = `${p.title} ${año}`
    } catch (e) {
      console.error(`[zonadepadel] No se pudo obtener año de ${p.url}:`, e.message)
    }
    await sleep(DELAY_MS)
  }
}

async function scrapeBrandCat(load, catPath) {
  const products = []
  let page = 1

  while (true) {
    const url = page === 1
      ? `${BASE_URL}${catPath}`
      : `${BASE_URL}${catPath}?page=${page}`

    let html
    try { html = await fetchPage(url) }
    catch (e) { console.error(`[zonadepadel] Error ${url}:`, e.message); break }

    const $ = load(html)
    const articles = $('article.product-miniature')
    if (articles.length === 0) break

    // Detect last page
    let lastPage = page
    $('.pagination a').each((_, a) => {
      const n = parseInt($(a).text().trim())
      if (!isNaN(n) && n > lastPage) lastPage = n
    })

    articles.each((_, art) => {
      const $a = $(art)
      const titleEl = $a.find('.product-title a, h2 a, h3 a').first()
      const title = titleEl.text().trim()
      const url   = titleEl.attr('href')
      if (!title || !url) return

      const price    = parsePrice($a.find('.boxed-price').first().text())
      const original = parsePrice($a.find('.regular-price').first().text())

      // Si no hay .boxed-price, buscar .price directamente
      const fallbackPrice = isNaN(price)
        ? parsePrice($a.find('.price').first().text())
        : price

      const finalPrice = isNaN(price) ? fallbackPrice : price
      if (isNaN(finalPrice) || finalPrice < 30) return

      // Imagen — PrestaShop, posible lazy-load (data-src con la url real).
      const imgEl  = $a.find('a.product-thumbnail img, img').first()
      const rawImg = imgEl.attr('data-src') || imgEl.attr('src') || ''
      const image  = rawImg.startsWith('data:') ? null : (rawImg.split('?')[0] || null)

      products.push({
        title,
        price: finalPrice,
        precio_original: (!isNaN(original) && original > finalPrice) ? original : null,
        url,
        image,
      })
    })

    console.log(`[zonadepadel] ${catPath} p${page}/${lastPage} → ${articles.length} productos`)

    if (page >= lastPage) break
    page++
    await sleep(DELAY_MS)
  }

  return products
}

async function scrape() {
  console.log('[zonadepadel] Iniciando scraper (fetch + cheerio, por marcas)…')

  let load
  try { ({ load } = require('cheerio')) }
  catch { console.error('[zonadepadel] cheerio no instalado'); return [] }

  const allProducts = []
  const seen = new Set()

  for (const catPath of BRAND_CATS) {
    const products = await scrapeBrandCat(load, catPath)
    for (const p of products) {
      if (seen.has(p.url)) continue
      seen.add(p.url)
      allProducts.push(p)
    }
    await sleep(DELAY_MS)
  }

  console.log(`[zonadepadel] Total palas únicas: ${allProducts.length}`)

  const sinAño = allProducts.filter(p => !TIENE_AÑO_RE.test(p.title))
  if (sinAño.length > 0) {
    console.log(`[zonadepadel] Completando año en ficha para ${sinAño.length} productos sin año en el título…`)
    await completarAñoSiFalta(load, sinAño)
  }

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
