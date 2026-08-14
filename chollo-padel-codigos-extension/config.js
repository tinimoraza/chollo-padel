// ============================================================
// CHOLLO PADEL CÓDIGOS — Configuración
// ============================================================
// Extensión independiente (2026-08-14, pedido explícito de Patricia: "no me
// gusta que los codigos vayan en el mismo addon, es un puto cristo") — antes
// vivía dentro de chollo-padel-tiendas-extension, ahora es su propia
// extensión con su propio ciclo, sin tocar ni depender del scraper de
// catálogo.
//
// Para añadir una tienda nueva:
//   1. Añadir entrada en CODIGOS_TIENDAS
//   2. Añadir su dominio en manifest.json → host_permissions
//   3. Recargar la extensión en chrome://extensions

const CONFIG = {
  SUPABASE_URL: 'https://vgbyhdnhsngaehruirwb.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZnYnloZG5oc25nYWVocnVpcndiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODExMTY4NSwiZXhwIjoyMDkzNjg3Njg1fQ.UR7pY7dpHasy7gtHHbsSh6p6keY4fxRB9ZBJe0sFfwg',

  // Modo prueba (2026-08-14, activado por falsos positivos detectados por
  // Patricia): con esto en true, la extensión NO escribe nada en
  // codigos_descuento_manual — solo registra en el log, pasada a pasada, qué
  // habría hecho (guardar/desactivar código). Revisar el log varios días
  // seguidos antes de poner esto en false y dejarla escribir de verdad.
  DRY_RUN: true,

  // Cada cuántas horas escanea todas las tiendas (mínimo pedido: 2/día)
  INTERVAL_HOURS: 6,

  // Pausa entre tiendas dentro de un ciclo (ms)
  DELAY_BETWEEN_STORES_MS: 400,
}

// Todas las tiendas ACTIVAS del pipeline (price_sources.activa = true,
// 2026-08-14). Se escanea su home (o la URL más representativa disponible)
// buscando banners/textos de código de descuento — no hace falta más porque
// no se recorre catálogo, solo se lee la página una vez.
//
// needsTab: true → la tienda bloquea fetch directo (403 / Cloudflare
// Turnstile) y hace falta abrir un tab real de Chrome para conseguir el HTML.
const CODIGOS_TIENDAS = [
  { source_id: 1,  source_key: 'padelnuestro',     url: 'https://www.padelnuestro.com' },
  { source_id: 2,  source_key: 'padelzoom',         url: 'https://padelzoom.es/palas/' },
  { source_id: 3,  source_key: 'tennispoint',       url: 'https://www.tennis-point.es' },
  { source_id: 6,  source_key: 'padelproshop',      url: 'https://www.padelproshop.com' },
  // padeliberico (source_id 8) fuera a propósito — ver nota mas abajo.
  { source_id: 9,  source_key: 'romasport',         url: 'https://romasport.es' },
  { source_id: 10, source_key: 'padelcoronado',     url: 'https://padelcoronado.com', needsTab: true },
  { source_id: 18, source_key: 'padelmarket',       url: 'https://padelmarket.com' },
  { source_id: 19, source_key: 'tiendapadelpoint',  url: 'https://www.tiendapadelpoint.com', needsTab: true },
  { source_id: 21, source_key: 'streetpadel',       url: 'https://www.streetpadel.com' },
  { source_id: 22, source_key: 'zonadepadel',       url: 'https://www.zonadepadel.es' },
  { source_id: 23, source_key: 'ofertasdepadel',    url: 'https://www.ofertasdepadel.com' },
  { source_id: 24, source_key: 'starvie',           url: 'https://starvie.com' },
  { source_id: 25, source_key: 'padelvice',         url: 'https://www.padelvice.com' },
  // misterpadel (source_id 27) fuera a propósito — ver nota mas abajo.
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
// dentro de una IMAGEN banner (detectado antes por OCR, no como texto en el
// HTML). Este escáner solo mira texto/HTML — si aquí nunca detecta nada para
// esta tienda, es señal de que sigue siendo un banner-imagen y haría falta
// OCR aparte o dejarlo en manual.

// Nota (padeliberico, 2026-08-14): sacada a propósito de este escáner.
// Confirmado por Patricia — sus códigos son POR PRODUCTO (ej. "HOT20" solo
// vale para los "productos seleccionados" de la sección /rebajas-verano,
// no para todo el catálogo). Este escáner solo comprueba la home y, si
// detectara un código ahí, lo guardaría en codigos_descuento_manual como
// código DE TIENDA — se aplicaría a TODOS los productos de padeliberico, lo
// cual sería incorrecto. El scraper Node (pipeline-tiendas.ts →
// padeliberico.js) ya hace esto bien: entra en la sección de rebajas,
// detecta el código ahí y lo graba solo en los productos de esa sección
// (price_snapshots.codigo_descuento por producto), que además ya se aplica
// en /api/chollos y en GestorCandidatas (fallback al código del propio
// snapshot cuando no hay código de tienda en vivo). No hace falta que este
// escáner de home la cubra también.

// Nota (misterpadel, 2026-08-14): sacada a propósito, mismo motivo que
// padeliberico. El scraper Node (misterpadel.js) comprueba el cupón FICHA A
// FICHA — cada producto puede llevar un cupón distinto (automático de
// carrito o checkbox opcional), no hay "un código de tienda" único. Auditoría
// completa (2026-08-14) de los 31 scrapers restantes confirmó que
// misterpadel es el ÚNICO caso además de padeliberico con código
// per-producto — el resto (30/31) detecta el código una sola vez a nivel de
// catálogo completo, así que sí es correcto tratarlos como código de tienda
// en este escáner.
