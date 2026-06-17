// scripts/prices/scrapers/streetpadel.js
// osCommerce — fetch + cheerio
// ~12 páginas, ~1200 productos en categoría palas

const SOURCE_KEY = 'streetpadel'
const BASE_URL   = 'https://www.streetpadel.com/palas-de-padel-c-49.html'
const DELAY_MS   = 700

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function parsePrice(text) {
  if (!text) return NaN
  const m = text.match(/([\d.]+,\d{2})/)
  if (!m) return NaN
  return parseFloat(m[1].replace('.', '').replace(',', '.'))
}

async function fetchPage(pageNum) {
  const url = pageNum === 1 ? BASE_URL : `${BASE_URL}?page=${pageNum}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  // La web no manda charset en las cabeceras pero el HTML va en Latin-1 (ISO-8859-1),
  // no UTF-8. res.text() asume UTF-8 y destroza Ñ/Á/Í/Ó/É → "�" (rompe el matching
  // de nombres de jugador y modelos con tildes). Decodificamos explícitamente como Latin-1.
  const buf = Buffer.from(await res.arrayBuffer())
  return new TextDecoder('iso-8859-1').decode(buf)
}

async function scrape() {
  console.log('[streetpadel] Iniciando scraper (fetch + cheerio)…')

  let cheerio
  try { ({ load: cheerio } = require('cheerio')) }
  catch { console.error('[streetpadel] cheerio no instalado'); return [] }

  const allProducts = []
  const seen = new Set()
  let totalPages = 1

  // Primera página para detectar total de páginas
  let html
  try { html = await fetchPage(1) }
  catch (e) { console.error('[streetpadel] Error página 1:', e.message); return [] }

  const $ = cheerio(html)
  // Detectar total páginas (último número en paginación)
  const pageNums = []
  $('[class*="pag"] a, .pagination a').each((_, el) => {
    const n = parseInt($(el).text().trim())
    if (!isNaN(n)) pageNums.push(n)
  })
  if (pageNums.length > 0) totalPages = Math.max(...pageNums)
  console.log(`[streetpadel] Total páginas: ${totalPages}`)

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    if (pageNum > 1) {
      try { html = await fetchPage(pageNum) }
      catch (e) { console.error(`[streetpadel] Error página ${pageNum}:`, e.message); break }
    }

    const $p = cheerio(html)
    const container = $p('#contenedor_productos')
    let newInPage = 0

    container.find('li').each((_, li) => {
      const $li = $p(li)

      // URL — product link without query string
      const productLink = $li.find('a').filter((_, a) => {
        const h = $p(a).attr('href') || ''
        return h.includes('-p-') && !h.includes('?') && !h.includes('osCsid')
      }).first()

      const url = productLink.attr('href')
      if (!url || seen.has(url)) return
      seen.add(url)

      // Title from <h4> or longest clean <a> text
      let title = $li.find('h4').first().text().trim()
      if (!title) {
        title = $li.find('a').filter((_, a) => {
          const h = $p(a).attr('href') || ''
          return h.includes('-p-') && !h.includes('?')
        }).map((_, a) => $p(a).text().trim()).get().sort((a, b) => b.length - a.length)[0] || ''
      }
      if (!title) return

      // Prices: <dd> = current price, <strong> = original price
      const price    = parsePrice($li.find('dd').first().text())
      const original = parsePrice($li.find('strong').first().text())

      if (isNaN(price) || price < 30) return

      allProducts.push({
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url,
      })
      newInPage++
    })

    console.log(`[streetpadel] Página ${pageNum}/${totalPages} → ${newInPage} palas nuevas`)

    if (newInPage === 0 && pageNum > 3) break
    if (pageNum < totalPages) await sleep(DELAY_MS)
  }

  console.log(`[streetpadel] Total palas únicas: ${allProducts.length}`)
  const scraped_at = new Date().toISOString()
  return allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    scraped_at,
  }))
}

module.exports = { scrape, SOURCE_KEY }
