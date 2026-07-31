// ============================================================
// CHOLLO PADEL TIENDAS — Configuración
// ============================================================
// Addon independiente que scrapeá tiendas WooCommerce directamente
// desde Chrome, evitando Cloudflare Turnstile sin proxies ni Playwright.
//
// Para añadir una tienda nueva:
//   1. Añadir entrada en TIENDAS
//   2. Añadir su dominio en manifest.json → host_permissions
//   3. Recargar la extensión en chrome://extensions

const CONFIG = {
  SUPABASE_URL: 'https://vgbyhdnhsngaehruirwb.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZnYnloZG5oc25nYWVocnVpcndiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODExMTY4NSwiZXhwIjoyMDkzNjg3Njg1fQ.UR7pY7dpHasy7gtHHbsSh6p6keY4fxRB9ZBJe0sFfwg',

  // Intervalo entre ciclos completos de scraping (en horas)
  INTERVAL_HOURS: 2,

  // Pausa entre tiendas en un mismo ciclo (ms)
  DELAY_BETWEEN_STORES_MS: 3000,

  // Pausa entre páginas de paginación (ms)
  DELAY_BETWEEN_PAGES_MS: 1200,
}

// ── Tiendas a scrapeár ─────────────────────────────────────
// type: 'woocommerce' → usa /wp-json/wc/store/v1/products
// source_id: ID en tabla price_sources de Supabase
// price_min: precio mínimo para filtrar accesorios (<30€ = grip, pelotas, etc.)

const TIENDAS = [
  {
    source_key: 'padelcoronado',
    source_id:  10,
    nombre:     'Padel Coronado',
    base_url:   'https://padelcoronado.com',
    type:          'woocommerce-tab',  // CF Turnstile — scraping via tab injection
    category:      'palas-padel',
    per_page:      100,
    price_min:     30,
    backoffOnFail: true,  // Si falla, esperar 24h antes de reintentar (deja enfriar la IP)
  },
  {
    source_key: 'padelstyle',
    source_id:  38,
    nombre:     'Padel Style',
    base_url:   'https://www.padelstyle.com',
    type:       'woocommerce',
    category:   'palas-de-padel',
    per_page:   100,
    price_min:  30,
  },
  {
    source_key: 'padeltienda',
    source_id:  40,
    nombre:     'Padel Tienda',
    base_url:   'https://padel.tienda',
    type:       'woocommerce',
    category:   'palas-padel',
    per_page:   100,
    price_min:  30,
  },
  {
    source_key:  'tiendapadelpoint',
    source_id:   19,
    nombre:      'Tienda PadelPoint',
    base_url:    'https://www.tiendapadelpoint.com/palas-de-padel',
    type:        'opencart-tab',  // HTTP 403 en fetch directo → usar tab para heredar cookies de sesión
    price_min:   30,
    pala_prefix: true,  // Sus títulos empiezan por "Pala " — filtro estricto
    // page_style no aplica: usa ?page=N (default 'query')
  },
  {
    source_key: 'originalpadel',
    source_id:  42,
    nombre:     'Original Padel',
    base_url:   'https://originalpadel.com/es/palas-de-padel/',
    type:       'opencart-tab',  // CF bloquea Playwright → scraping via tab Chrome
    page_style: 'path',         // Paginación: /page/N/ en vez de ?page=N
    price_min:  30,
    // pala_prefix: false (default) → usa esPala() de EXCLUIR_TITULOS
  },
]

// ── Lista de palabras que indican que NO es una pala ──────
const EXCLUIR_TITULOS = [
  'grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta',
  'zapatilla', 'gafas', 'kit ', ' kit', 'sudadera', 'pantalon',
  'pantalón', 'malla', 'boxer', 'polo ', 'chaqueta', 'gorra',
  'calcetín', 'calcetines', 'leggin', 'chandal', 'chándal',
  'set ', ' set', 'pack ', ' pack',
]

function esPala(titulo) {
  const t = (titulo || '').toLowerCase()
  return !EXCLUIR_TITULOS.some(w => t.includes(w))
}
