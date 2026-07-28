// scripts/prices/scrapers/tiendapadelpoint.js
// OpenCart — Playwright (necesita cookies de sesión para paginación)
// ~850 productos totales, filtramos por título "Pala ..."
// NOTA (fix 2026-06-18): el tema ya no usa ".product-details" para la tarjeta —
// ahora es ".product-thumb", con título/link en ".name a" dentro de ".caption"
// (el primer <a> de la tarjeta es el botón "Vista Rápida" sin href, por eso
// hay que apuntar directamente a ".name a").

const SOURCE_KEY  = 'tiendapadelpoint'
const BASE_URL    = 'https://www.tiendapadelpoint.com/palas-de-padel'
const DELAY_MS    = 800

const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

// OCR sobre imagen de banner de rebajas (tiendapadelpoint usa imágenes WebP en lugar de texto
// para los banners de cupón: "REBAJAS DESCUENTO EXTRA -15% APLICANDO CUPÓN SALE15").
// Usa sharp (ya instalado) para upscale 4x → mejor precisión de Tesseract.
// Falla silenciosamente si tesseract.js o sharp no están disponibles.
async function detectarCodigoEnBannerImagen(imgUrl) {
  // Devuelve: objeto {codigo, descuento_pct} si hay código,
  //           null si el OCR corrió y NO hay código (banner sin cupón),
  //           undefined si el OCR no pudo correr (fallo de red, tesseract no disponible…)
  try {
    const { createWorker } = require('tesseract.js')
    const sharp = require('sharp')
    const res = await fetch(imgUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
    })
    if (!res.ok) { console.log(`[tiendapadelpoint] OCR: imagen no accesible (${res.status})`); return undefined }
    const buf = Buffer.from(await res.arrayBuffer())
    // Upscale a 200px de alto: la imagen 2x es 1440×60 → queda ~4800×200, legible por Tesseract
    const pngBuf = await sharp(buf).resize({ height: 200 }).png().toBuffer()
    const worker = await createWorker('eng')
    const { data: { text } } = await worker.recognize(pngBuf)
    await worker.terminate()
    const ocrText = text.replace(/\n/g, ' ').trim()
    console.log(`[tiendapadelpoint] OCR banner: "${ocrText}"`)
    return detectarCodigoDescuento(ocrText) // null si no hay código
  } catch (e) {
    console.log(`[tiendapadelpoint] OCR no disponible: ${e.message.substring(0, 100)}`)
    return undefined // indefinido = no pudimos correr el OCR
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function parsePrice(text) {
  if (!text) return NaN
  // Formato "39.95 €" (punto decimal) o "1.299,95 €" (punto miles, coma decimal)
  const clean = text.trim()
  // Si hay coma: es el decimal (formato ES con miles con punto)
  if (clean.includes(',')) {
    return parseFloat(clean.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''))
  }
  // Si solo tiene punto: es decimal directo
  return parseFloat(clean.replace(/[^\d.]/g, ''))
}

function extractProductsFromPage(page) {
  return page.evaluate(() => {
    function parsePrice(text) {
      if (!text) return NaN
      const clean = text.trim()
      if (clean.includes(',')) {
        return parseFloat(clean.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''))
      }
      return parseFloat(clean.replace(/[^\d.]/g, ''))
    }

    // tiendapadelpoint es inconsistente: algunos productos muestran precio SIN IVA
    // y otros CON IVA en el listing (bug OpenCart). Heurística: si precio × 1.21
    // da un número de retail (decimal .90-.99 o .00-.05 o .50), aplicar IVA.
    function aplicarIVA(p) {
      if (!p || isNaN(p) || p <= 0) return p
      const conIVA = Math.round(p * 121) / 100  // evitar float con ×100 antes
      const cents  = conIVA % 1                  // parte decimal
      const centsRounded = Math.round(cents * 100)
      const esRetail = centsRounded >= 90 || centsRounded <= 5 || centsRounded === 50
      return esRetail ? conIVA : p
    }

    const items = []
    const blocks = document.querySelectorAll('.product-thumb')
    for (const pd of blocks) {
      const a = pd.querySelector('.name a')
      const title = a?.textContent?.trim()
      const url   = a?.href
      if (!title || !url) continue
      if (!title.toLowerCase().startsWith('pala ')) continue
      if (title.toLowerCase().includes('pickleball')) continue

      const priceNew = pd.querySelector('.price-new')?.textContent
      const priceOld = pd.querySelector('.price-old')?.textContent
      // Fallback: .price contiene ambos "70.00 €  39.95 €" — coger el menor
      let price = NaN, original = NaN

      if (priceNew) {
        price    = parsePrice(priceNew)
        original = priceOld ? parsePrice(priceOld) : NaN
      } else {
        const priceEl = pd.querySelector('.price')
        if (priceEl) {
          const matches = [...priceEl.textContent.matchAll(/([\d.,]+)\s*€/g)]
            .map(m => parsePrice(m[0]))
            .filter(n => !isNaN(n) && n > 0)
          if (matches.length >= 2) { price = Math.min(...matches); original = Math.max(...matches) }
          else if (matches.length === 1) price = matches[0]
        }
      }

      if (isNaN(price) || price < 30) continue

      const finalPrice    = aplicarIVA(price)
      const finalOriginal = (!isNaN(original) && original > price)
        ? aplicarIVA(original)
        : NaN

      const imgEl  = pd.querySelector('.image img, img')
      const rawImg = imgEl?.getAttribute('data-src') || imgEl?.getAttribute('src') || ''
      const image  = (!rawImg || rawImg.startsWith('data:')) ? null : rawImg.split('?')[0]

      items.push({
        title,
        price:           finalPrice,
        precio_original: !isNaN(finalOriginal) ? finalOriginal : null,
        url,
        image,
      })
    }
    return items
  })
}

const fs = require('fs')
const path = require('path')
const CACHE_FILE = path.join(__dirname, '_tiendapadelpoint_cache.json')
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 horas

async function readCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null
    const { timestamp, products, codigoDescuento: codigoCached, bannerImgUrl } = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    if (Date.now() - timestamp > CACHE_MAX_AGE_MS) return null
    console.log(`[tiendapadelpoint] Cache válido (${products.length} palas, ${Math.round((Date.now()-timestamp)/60000)} min)`)
    // Verificar si el código sigue activo via OCR del banner (fetch directo, sin Playwright)
    // undefined = OCR no disponible (conservar cache); null = banner sin código; objeto = código activo
    let codigoFinal = codigoCached ?? null
    if (bannerImgUrl) {
      console.log(`[tiendapadelpoint] Verificando código de descuento (OCR banner)…`)
      const codigoOcr = await detectarCodigoEnBannerImagen(bannerImgUrl)
      if (codigoOcr !== undefined) {
        codigoFinal = codigoOcr
        if (codigoOcr) console.log(`[tiendapadelpoint] Código activo (OCR): ${codigoOcr.codigo} (-${codigoOcr.descuento_pct}%)`)
        else console.log(`[tiendapadelpoint] Banner sin código activo`)
      } else {
        // OCR no pudo correr → conservar lo que había en cache
        if (codigoCached) console.log(`[tiendapadelpoint] OCR no disponible, usando código del cache: ${codigoCached.codigo} (-${codigoCached.descuento_pct}%)`)
      }
    }
    products.codigoDescuento = codigoFinal
    return products
  } catch { return null }
}

async function scrape() {
  const cached = await readCache()
  if (cached) return cached

  console.log('[tiendapadelpoint] Iniciando scraper (Playwright)…')

  // Cloudflare Bot Management bloquea Playwright headless con HTTP 403.
  // Solución: conectar al Chrome real de la usuaria via CDP (Chrome DevTools Protocol).
  // Chrome debe estar corriendo con --remote-debugging-port=9222.
  // El scraper no cierra Chrome al terminar — solo cierra su propia página.
  let page, browser, context, usandoCDP = false
  try {
    const puppeteer = require('puppeteer-core')
    browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
    page = await browser.newPage()
    usandoCDP = true
    console.log('[tiendapadelpoint] Conectado al Chrome real via CDP (cf_clearance disponible)')
  } catch {
    // Fallback: launchPersistentContext con perfil real (requiere Chrome cerrado)
    const { chromium } = require('playwright')
    const CHROME_USER_DATA = process.env.CHROME_USER_DATA ||
      require('path').join(require('os').homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data')
    try {
      context = await chromium.launchPersistentContext(CHROME_USER_DATA, {
        headless: false,
        channel: 'chrome',
        args: ['--profile-directory=Default', '--no-first-run', '--no-default-browser-check'],
      })
      page = await context.newPage()
      console.log('[tiendapadelpoint] Usando Chrome real con perfil de usuario (fallback)')
    } catch (e2) {
      console.error('[tiendapadelpoint] No se pudo conectar a Chrome:', e2.message)
      console.error('[tiendapadelpoint] Para activar CDP: añade --remote-debugging-port=9222 al shortcut de Chrome')
      return []
    }
  }

  const allProducts = []
  const seen = new Set()
  let pageNum = 1

  // Primera carga para establecer sesión y conocer total de páginas
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2000)

  // Cerrar cookies si aparece
  try {
    await page.waitForSelector('[class*="cookie"] button, .cc-btn, .accept-btn', { timeout: 4000 })
    await page.click('[class*="cookie"] button, .cc-btn, .accept-btn')
    await page.waitForTimeout(1000)
  } catch {}

  // Detectar total de páginas.
  // Formato antiguo (ya no existe): "(36 Páginas)" → regex \((\d+)\s*P.ginas?\)
  // Formato nuevo: paginación numérica + link ">|" con href "?page=N" (última página)
  const totalPages = await page.evaluate(() => {
    const pag = document.querySelector('.pagination')?.textContent || ''
    const mOld = pag.match(/\((\d+)\s*P.ginas?\)/)
    if (mOld) return parseInt(mOld[1])
    // Nuevo: el último <a> de la paginación (">|") lleva a la última página
    const pagAs = Array.from(document.querySelectorAll('.pagination a'))
    const lastA = pagAs[pagAs.length - 1]
    const mLast = lastA?.href?.match(/[?&]page=(\d+)/)
    if (mLast) return parseInt(mLast[1])
    return 36  // fallback conservador
  })
  console.log(`[tiendapadelpoint] Total páginas: ${totalPages}`)

  // IMPORTANTE: NO se hace goto(homepage) aquí — interfiere con la sesión Playwright
  // y hace que las siguientes páginas devuelvan 0 productos. El check de homepage
  // se hace DESPUÉS del while loop (ver más abajo).
  //
  // Detectar código desde el listing inicial (ya cargado con 2000ms de espera)
  let codigoDescuento = null
  {
    const listingHtml = await page.evaluate(() => document.documentElement.innerHTML)
    codigoDescuento = detectarCodigoDescuento(listingHtml)
    const htmlLow = listingHtml.toLowerCase()
    const tieneSale  = /\bsale\d{1,2}\b/.test(htmlLow)
    const tieneCupon = /c[oó]digo|cup[oó]n/.test(htmlLow)
    console.log(`[tiendapadelpoint] listing: sale_code_pattern=${tieneSale}, cupon_keyword=${tieneCupon}, detectado=${!!codigoDescuento}`)
  }

  // Obtener primerProductUrl y rebajasUrls del listing inicial (sin goto adicional)
  const primerProductUrl = await page.evaluate(() => {
    const a = document.querySelector('.product-thumb .name a')
    return a?.href || null
  })

  const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href))
  const rebajasUrls = filtrarUrlsRebajas(hrefs, BASE_URL)
  if (rebajasUrls.length > 0) {
    console.log(`[tiendapadelpoint] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
  }

  while (pageNum <= totalPages) {
    if (pageNum > 1) {
      await page.goto(`${BASE_URL}?page=${pageNum}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(1500)
    }

    const products = await extractProductsFromPage(page)
    console.log(`[tiendapadelpoint] Página ${pageNum}/${totalPages} → ${products.length} palas`)

    let newInPage = 0
    for (const p of products) {
      if (seen.has(p.url)) continue
      seen.add(p.url)
      allProducts.push(p)
      newInPage++
    }

    // Si llevamos 3 páginas sin productos nuevos, paramos
    if (newInPage === 0 && pageNum > 3) break

    pageNum++
    await sleep(DELAY_MS)
  }

  // Check de homepage DESPUÉS del while loop (no antes, para no interferir con la sesión).
  // Si el listing ya dio código, se salta; si no, se intenta homepage.
  if (!codigoDescuento) {
    try {
      await page.goto('https://www.tiendapadelpoint.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(2000)
      const homeHtml = await page.evaluate(() => document.documentElement.innerHTML)
      codigoDescuento = detectarCodigoDescuento(homeHtml)
      const htmlLow = homeHtml.toLowerCase()
      const tieneSale  = /\bsale\d{1,2}\b/.test(htmlLow)
      const tieneCupon = /c[oó]digo|cup[oó]n/.test(htmlLow)
      console.log(`[tiendapadelpoint] homepage: sale_code_pattern=${tieneSale}, cupon_keyword=${tieneCupon}, detectado=${!!codigoDescuento}`)
      // Volver al listing después del check
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(1500)
    } catch (e) {
      console.log(`[tiendapadelpoint] homepage check error: ${e.message}`)
    }
  }
  if (codigoDescuento) {
    console.log(`[tiendapadelpoint] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
  } else {
    console.log(`[tiendapadelpoint] no se detectó ningún código de descuento`)
  }

  // Siempre revisar un producto de la sección de REBAJAS con OCR.
  // El banner "CUPÓN SALE15" es una imagen WebP — invisible para el detector de texto.
  // Se ejecuta SIEMPRE (no solo si !codigoDescuento) para que el OCR pueda
  // sobreescribir cualquier falso positivo detectado en el listing de texto.
  let capturedBannerImgUrl = null
  {
    let urlAComprobar = null

    if (rebajasUrls.length > 0) {
      // Navegar a la primera sección de rebajas y extraer el primer producto
      try {
        await page.goto(rebajasUrls[0], { waitUntil: 'domcontentloaded', timeout: 30000 })
        await page.waitForTimeout(1500)
        urlAComprobar = await page.evaluate(() => {
          const a = document.querySelector('.product-thumb .name a')
          return a?.href || null
        })
        console.log(`[tiendapadelpoint] primer producto en rebajas: ${urlAComprobar}`)
      } catch (e) {
        console.log(`[tiendapadelpoint] error navegando a rebajas: ${e.message}`)
      }
    }

    // Último recurso: primer producto del listing general
    if (!urlAComprobar) urlAComprobar = primerProductUrl

    if (urlAComprobar) {
      try {
        await page.goto(urlAComprobar, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await page.waitForTimeout(1500)
        const prodHtml = await page.evaluate(() => document.documentElement.innerHTML)
        const codigoTexto = detectarCodigoDescuento(prodHtml)
        // OCR sobre imagen de banner: tiene prioridad sobre cualquier código de texto
        // (el texto del listing es propenso a falsos positivos; el banner imagen es explícito)
        const bannerImgUrl = await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll('[class*="module-banners"] img'))
          const found = imgs.find(i => /rebaj|sale|cupon|descuento|campa/i.test(i.src || ''))
          if (!found) return null
          // Preferir versión 2x (más resolución → mejor OCR)
          const srcset = found.getAttribute('srcset') || ''
          const m2x = srcset.match(/(\S+)\s+2x/)
          return m2x ? m2x[1] : (found.src || null)
        })
        if (bannerImgUrl) capturedBannerImgUrl = bannerImgUrl
        let codigoOcr = null
        if (bannerImgUrl) {
          console.log(`[tiendapadelpoint] banner imagen detectado, intentando OCR: ${bannerImgUrl}`)
          const ocrResult = await detectarCodigoEnBannerImagen(bannerImgUrl)
          if (ocrResult !== undefined) codigoOcr = ocrResult
        }
        // OCR prevalece sobre texto; si ninguno, conservar lo encontrado antes (home/listing)
        if (codigoOcr) {
          codigoDescuento = codigoOcr
          console.log(`[tiendapadelpoint] codigo detectado (OCR banner): ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
        } else if (codigoTexto) {
          codigoDescuento = codigoTexto
          console.log(`[tiendapadelpoint] codigo detectado (texto producto): ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
        } else {
          console.log(`[tiendapadelpoint] no se detectó ningún código en página producto`)
        }
      } catch (e) {
        console.log(`[tiendapadelpoint] error chequeando página producto: ${e.message}`)
      }
    }
  }

  for (const rebajasUrl of rebajasUrls) {
    try {
      await page.goto(rebajasUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(1500)
      const products = await extractProductsFromPage(page)
      let added = 0
      for (const p of products) {
        if (seen.has(p.url)) continue
        seen.add(p.url)
        allProducts.push(p)
        added++
      }
      console.log(`[tiendapadelpoint] sección rebajas ${rebajasUrl} → ${added} palas nuevas`)
    } catch (e) {
      console.error(`[tiendapadelpoint] Error sección rebajas ${rebajasUrl}:`, e.message)
    }
    await sleep(DELAY_MS)
  }

  if (usandoCDP) {
    await page.close()      // Solo cierra la pestaña, NO Chrome
    browser.disconnect()
  } else if (context) {
    await context.close()   // Cierra el perfil Playwright
  }

  console.log(`[tiendapadelpoint] Total palas únicas: ${allProducts.length}`)
  // Guardar cache para próximas ejecuciones (incluye código y URL de banner para OCR sin Playwright)
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      timestamp:      Date.now(),
      products:       allProducts,
      codigoDescuento: codigoDescuento ?? null,
      bannerImgUrl:   capturedBannerImgUrl,
    }))
    console.log(`[tiendapadelpoint] Cache guardado (${allProducts.length} palas)`)
  } catch (e) {
    console.log(`[tiendapadelpoint] Error guardando cache: ${e.message}`)
  }
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
