// chollo-padel-tiendas-extension/codigos-scanner.js
//
// Escáner independiente de códigos de descuento (2026-08-14, pedido
// explícito de Patricia): decide sustituir la detección de códigos que
// vivía repartida en cada scraper (21 ficheros Node + el ciclo de scraping
// de esta extensión) por UN ÚNICO componente que solo visita la home/página
// de rebajas de cada tienda — sin recorrer catálogo — y corre varias veces
// al día. Así la frescura del código deja de depender de si esa tienda
// concreta scrapeó su catálogo hoy.
//
// Este fichero define QUÉ tiendas escanear y lanza el escaneo; la
// detección en sí (detectarCodigoDescuento) y el guardado/sincronización
// en BD (sincronizarCodigoDescuento) ya existen en discount-utils.js y
// background.js respectivamente — se reutilizan tal cual.

// Todas las tiendas ACTIVAS del pipeline (price_sources.activa = true,
// 2026-08-14). Se escanea su home (o la URL más representativa disponible)
// buscando banners/textos de código de descuento — no hace falta más
// porque no se recorre catálogo, solo se lee la página una vez.
const CODIGOS_TIENDAS = [
  { source_id: 1,  source_key: 'padelnuestro',     url: 'https://www.padelnuestro.com' },
  { source_id: 2,  source_key: 'padelzoom',         url: 'https://padelzoom.es/palas/' },
  { source_id: 3,  source_key: 'tennispoint',       url: 'https://www.tennis-point.es' },
  { source_id: 6,  source_key: 'padelproshop',      url: 'https://www.padelproshop.com' },
  { source_id: 8,  source_key: 'padeliberico',      url: 'https://www.padeliberico.com' },
  { source_id: 9,  source_key: 'romasport',         url: 'https://romasport.es' },
  { source_id: 10, source_key: 'padelcoronado',     url: 'https://padelcoronado.com', needsTab: true },
  { source_id: 18, source_key: 'padelmarket',       url: 'https://padelmarket.com' },
  { source_id: 19, source_key: 'tiendapadelpoint',  url: 'https://www.tiendapadelpoint.com', needsTab: true },
  { source_id: 21, source_key: 'streetpadel',       url: 'https://www.streetpadel.com' },
  { source_id: 22, source_key: 'zonadepadel',       url: 'https://www.zonadepadel.es' },
  { source_id: 23, source_key: 'ofertasdepadel',    url: 'https://www.ofertasdepadel.com' },
  { source_id: 24, source_key: 'starvie',           url: 'https://starvie.com' },
  { source_id: 25, source_key: 'padelvice',         url: 'https://www.padelvice.com' },
  { source_id: 27, source_key: 'misterpadel',       url: 'https://www.misterpadel.com' },
  { source_id: 29, source_key: 'time2padel',        url: 'https://www.time2padel.com' },
  { source_id: 31, source_key: 'padelkiwi',         url: 'https://www.padelkiwi.com' },
  { source_id: 32, source_key: 'padelspain',        url: 'https://www.padel-spain.es' },
  { source_id: 34, source_key: 'tiendapadel5',      url: 'https://tiendapadel5.com' },
  { source_id: 35, source_key: 'allforpadel',       url: 'https://allforpadel.com' },
  { source_id: 38, source_key: 'padelstyle',        url: 'https://www.padelstyle.com' },
  { source_id: 39, source_key: 'm1padel',           url: 'https://www.m1padel.com' },
  { source_id: 40, source_key: 'padeltienda',       url: 'https://padel.tienda' },
  { source_id: 41, source_key: 'stockpadel',        url: 'https://www.stockpadel.com' },
  { source_id: 42, source_key: 'originalpadel',     url: 'https://originalpadel.com', needsTab: true },
  { source_id: 43, source_key: 'futurapadelshop',   url: 'https://futurapadelshop.com' },
  { source_id: 44, source_key: 'justpadel',         url: 'https://justpadel.com' },
  { source_id: 45, source_key: 'virtualpadel',      url: 'https://virtualpadel.es' },
  { source_id: 46, source_key: 'outletdepadel',     url: 'https://outletdepadel.com' },
  { source_id: 50, source_key: 'padelmania',        url: 'https://padelmania.com' },
  { source_id: 51, source_key: 'keepadel',          url: 'https://keepadel.com' },
  { source_id: 52, source_key: 'pelotapadel',       url: 'https://pelotapadel.com' },
]

// Nota (tiendapadelpoint): el código en esta tienda históricamente vivía
// dentro de una IMAGEN banner (detectado antes por OCR en tiendapadelpoint.js,
// no como texto en el HTML). Este escáner solo mira texto/HTML — si el
// código deja de detectarse aquí para esta tienda concreta, lo más probable
// es que siga siendo un banner-imagen y haga falta OCR aparte. Se marca
// needsTab porque además devuelve 403 en fetch directo sin cookies de tab.

// Obtiene el HTML de una tienda para el escaneo de códigos. Reutiliza el
// mismo patrón fase1 (fetch directo con cookies)/fase2 (tab en background,
// sin popups ni CAPTCHA porque esto corre desatendido) que ya usa
// scrapeWooCommerceViaTab — pero sin abrir nunca un tab visible ni pedir
// interacción: si fase 2 también falla, simplemente se salta esa tienda
// este ciclo (se reintentará en el siguiente, cada pocas horas).
async function _codigosObtenerHtml(store, logLines) {
  const L = msg => { console.log(msg); logLines.push(`[LOG]  ${msg}`) }
  const hostname = new URL(store.url).hostname

  if (!store.needsTab) {
    try {
      const cookieHeader = await getCookieHeader(hostname)
      const headers = { Accept: 'text/html,application/xhtml+xml' }
      if (cookieHeader) headers['Cookie'] = cookieHeader
      const r = await fetch(store.url, { credentials: 'include', headers })
      if (r.ok) {
        const html = await r.text()
        if (html && html.length > 500) return html
      }
      L(`[codigos:${store.source_key}] fetch directo no válido (HTTP ${r.status}) — probando tab`)
    } catch (e) {
      L(`[codigos:${store.source_key}] fetch directo error: ${e.message} — probando tab`)
    }
  }

  // Fallback / tiendas marcadas needsTab: tab en background, sin foco, sin
  // notificaciones — si hay CF Turnstile interactivo sin resolver aún,
  // simplemente no se conseguirá HTML útil y se salta esta vuelta.
  let tabId
  try {
    const tab = await new Promise(r => chrome.tabs.create({ url: store.url, active: false }, r))
    tabId = tab.id
    const ready = await new Promise(resolve => {
      let done = false
      const timer = setTimeout(() => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(fn); resolve(false) } }, 25000)
      function fn(id, info) {
        if (id !== tabId || info.status !== 'complete') return
        if (!done) { done = true; clearTimeout(timer); chrome.tabs.onUpdated.removeListener(fn); resolve(true) }
      }
      chrome.tabs.onUpdated.addListener(fn)
    })
    if (!ready) { L(`[codigos:${store.source_key}] tab timeout`); return null }
    await sleep(800)
    const injected = await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      func: () => { try { return document.documentElement.outerHTML } catch (e) { return null } },
    })
    return injected?.[0]?.result || null
  } catch (e) {
    L(`[codigos:${store.source_key}] tab error: ${e.message}`)
    return null
  } finally {
    if (tabId) { try { chrome.tabs.remove(tabId, () => {}) } catch {} }
  }
}

// Ciclo completo: recorre las tiendas activas, obtiene su HTML y sincroniza
// el código detectado (o su ausencia) contra codigos_descuento_manual.
// Independiente del ciclo de scraping de catálogo (runScraper) — pensado
// para correr con más frecuencia (ver alarma 'scan-codigos' en background.js).
async function escanearCodigosTiendas() {
  const logLines = []
  const L = msg => { console.log(msg); logLines.push(`[LOG]  ${msg}`) }
  L(`=== Escaneo de códigos iniciado: ${new Date().toISOString()} ===`)

  let cambios = 0
  for (const store of CODIGOS_TIENDAS) {
    try {
      const html = await _codigosObtenerHtml(store, logLines)
      const tiendaFake = { source_id: store.source_id, source_key: store.source_key, _html1: html }
      const antes = codigosCache[store.source_id]
      await sincronizarCodigoDescuento(tiendaFake, logLines)
      const despues = codigosCache[store.source_id]
      if (JSON.stringify(antes) !== JSON.stringify(despues)) cambios++
    } catch (e) {
      L(`[codigos:${store.source_key}] Error: ${e.message}`)
    }
    await sleep(400)
  }

  L(`=== Escaneo de códigos terminado: ${cambios} cambios de ${CODIGOS_TIENDAS.length} tiendas ===`)
  guardarLog(logLines)
}
