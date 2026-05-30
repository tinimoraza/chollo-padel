// scripts/prices/fuzzy-matcher.js
// v7 (2026-05-28):
//   FIX 1 — extraerGeneracionDeUrl: extrae números de generación (01-09) del slug de URL.
//     Problema: Padel Coronado publica title="Bullpadel Neuron" (sin "02") para el Neuron 02.
//     El matcher veía solo "neuron" y elegía Neuron 2025 (más reciente sin versión) en lugar
//     del correcto Neuron 02 2026. El slug "/pala-bullpadel-neuron-02/" sí tiene "-02-" que
//     identifica la generación. Fix: inyectar "02" en tokensTitle desde URL.
//   FIX 2 — normalizar "pwr" → "power" en tokenizar().
//     Problema: catálogo tiene "Indiga PWR 2026", títulos de Vinted dicen "Indiga Power 2026".
//     "power" quedaba como diferenciador huérfano → el matcher elegía "Ionic Power" (que sí
//     tiene "power") en lugar de "Indiga PWR". Fix: pwr → power al inicio de tokenizar().
//   FIX 3 — filtrar "pickleball" en URL además de en el título.
//     Padeliberico.es lista palas de pickleball con URL "/pala-pickleball-head-extreme-pro.html"
//     pero title "Head Extreme Pro 2026" (sin "pickleball"). El pipeline solo filtraba el title.
//     Fix: añadir check de URL en pipeline.js (no en este archivo).
//
// v6 (2026-05-27):
//   FIX: extraerVersionDeUrl no devuelve versión si el título contiene un año
//   explícito DISTINTO al año que implica esa versión en el catálogo.
//   Problema raíz: PadelNuestro reutiliza slugs antiguos para productos nuevos.
//   Ej: /adidas-drive-3-3-blue-110135-p → slug "3-3" implica versión 3.3 (2023),
//   pero el título es "Adidas Drive Blue 2026". La URL pesa más que el título
//   y fuerza el match a Drive 3.3 2023 en vez de Drive Blue 2026.
//   Fix: fuzzyMatch() pasa el año del título a extraerVersionDeUrl(). Si hay
//   año en el título y la versión detectada en la URL solo existe en años
//   anteriores, la versión se descarta (devuelve null).
//   Efecto: Drive Blue 2026 ya no casa con Drive 3.3 2023. Match Light 2026
//   ya no casa con Match 3.2 2023.
//
// v5 (2026-05-26):
//   FIX ESTRUCTURAL: el matcher ahora recibe también la URL del producto y extrae
//   señales de año y versión de ella, además del título.
//   Problema raíz: PadelNuestro puede tener el mismo título para dos SKUs distintos
//   (Neuron 2024 y Neuron 25), pero la URL sí los distingue: bullpadel-neuron-25-*
//   implica año 2025. Del mismo modo, "drive-3-3" en URL implica versión 3.3.
//   Con este fix:
//     extraerAnioDeUrl("-25-" → 2025, "-26-" → 2026, etc.)
//     extraerVersionDeUrl("-3-3-" → "3.3", "-3-2-" → "3.2", etc.)
//   Las señales de URL tienen PRIORIDAD sobre el título cuando hay conflicto,
//   porque la URL es estructurada y generada por la tienda (más fiable que el título libre).
//   fuzzyMatch() acepta ahora un segundo argumento opcional: productUrl.
//
// v4 (2026-05-26):
//   FIX: colores añadidos a TOKENS_DIFERENCIADORES y KEEP_WORDS.
//   Problema: "Adidas Drive Black 2026" y "Adidas Drive Blue 2026" eran indistinguibles
//   porque black/blue/grey/white/red no estaban en KEEP_WORDS → tokenizador los descartaba.
//   Resultado: ambos candidatos pasaban fase estricta con los mismos tokens y ganaba
//   el primero en catálogo → "Drive Black" asignado a "Drive Blue" y viceversa.
//   Con este fix los colores se preservan como tokens y actúan como diferenciadores.
//
// v3 (2026-05-26):
//   FIX CRÍTICO: orden de desempates corregido.
//   Diferenciadores (Desempate 2) movido ANTES de especificidad (Desempate 3).
//   "Adipower Team 2023" → gana Adipower Team sobre Adipower 3.2 gracias al token "team".
//   "Arrow Hit Carbon" → gana Arrow Hit Carbon sobre Arrow Hit gracias al token "carbon".
//
// v2 (2026-05-25) — reescrito desde cero, abandona Jaro-Winkler

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// ─── Constantes ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'de', 'da', 'del', 'la', 'el', 'y', 'e', 'con', 'para', 'pala', 'padel',
  'raqueta', 'serie', 'series', 'edition', 'version', 'by',
  'a22', 'a23', 'a24', 'rc',
]);

const KEEP_WORDS = new Set([
  // Técnicos
  'hrd', 'ctrl', 'soft', 'air', 'light', 'team', 'carbon',
  'match', 'drive', 'arrow', 'cross', 'hit', 'rx',
  '18k', '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena', 'hard',
  'pro', 'evo', 'plus', 'motion', 'elite', 'genius', 'attack',
  'lite', 'x', 'proplus', 'woman', 'sft', 'power', 'speed',
  // v4: Colores — diferencian variantes de una misma familia
  // Ej: Adidas Drive Black 2026 vs Drive Blue 2026 vs Drive Grey 2026
  'black', 'blue', 'grey', 'white', 'red', 'green', 'orange', 'pink',
  'yellow', 'purple', 'gold', 'silver', 'navy', 'lime',
]);

const TOKENS_DIFERENCIADORES = new Set([
  // Técnicos
  'ctrl', 'carbon', 'team', 'hrd', 'light', 'soft', 'air',
  'pro', 'elite', 'attack', 'motion', 'drive', 'match',
  'arrow', 'cross', 'hit', 'rx', 'power', 'speed',
  '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena', 'sft',
  'hybrid', 'lite', 'x', 'proplus', 'woman',
  'extreme', 'vertex', 'hack', 'genius', 'viper',
  'zephyr', 'delta', 'flash', 'radical', 'instinct',
  'comfort', 'revolution', 'advance', 'jr',
  'st1', 'st2', 'st3', 'st4',
  'apt',      // Babolat Counter Viper APT es modelo distinto al Counter Viper estandar
  'hexagon',  // Adidas Arrow Hit Hexagon es variante distinta al Arrow Hit estandar
  'veron',    // Babolat Veron != Viper — evitar confusion entre familias con nombres similares
  // v4: Colores como diferenciadores
  'black', 'blue', 'grey', 'white', 'red', 'green', 'orange', 'pink',
  'yellow', 'purple', 'gold', 'silver', 'navy', 'lime',
]);

const JUGADORES_PATTERN = /\b(juan lebron|lebron|ale galan|ale gal[aá]n|martita ortega|alex ruiz|agust[ií]n tapia|arturo coello|paquito navarro|coki nieto|stupa|momo gonz[aá]lez|chingotto|franco chingotto|edu alonso|eduardo alonso)\b/gi;

const MARCAS_CONOCIDAS = {
  'bullpadel': 'Bullpadel',
  'nox': 'Nox',
  'head': 'Head',
  'adidas': 'Adidas',
  'babolat': 'Babolat',
  'wilson': 'Wilson',
  'dunlop': 'Dunlop',
  'starvie': 'StarVie',
  'star vie': 'StarVie',
  'vibora': 'Vibora',
  'vibor-a': 'Vibora',
  'siux': 'Siux',
  'royal padel': 'Royal Padel',
  'drop shot': 'Drop Shot',
  'dropshot': 'Drop Shot',
  'tecnifibre': 'Tecnifibre',
  'black crown': 'Black Crown',
  'varlion': 'Varlion',
  'joma': 'Joma',
  'jhayber': 'Jhayber',
  'harlem': 'Harlem',
  'kombat': 'Kombat',
  'lok': 'Lok',
  'oxdog': 'Oxdog',
  'enebe': 'Enebe',
  'puma': 'Puma',
  'vertex': 'Bullpadel',
  'hack': 'Bullpadel',
  'at10': 'Nox',
  'ml10': 'Nox',
  'metalbone': 'Adidas',
  'yarara': 'Vibora',
  'electra': 'Siux',
  'pegasus': 'Siux',
};

// ─── Tokenización ─────────────────────────────────────────────────────────────

function tokenizar(texto) {
  return texto
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/hrd\+/g, 'hrd')
    .replace(/\bhard\b/g, 'hrd')
    .replace(/\bsoft\b/g, 'sft')
    .replace(/\bctr\b/g, 'ctrl')
    .replace(/\bcontrol\b/g, 'ctrl')
    .replace(/\bpwr\b/g, 'power')    // Bullpadel: "Indiga PWR" → "Indiga Power" (evita que "power" en título no matchee "pwr" en catálogo)
    .replace(/pro\s*\+/g, 'proplus')
    .replace(/\bpro plus\b/g, 'proplus')
    .replace(/\b(st|electra st)\s+(\d)\b/g, '$1$2')
    .replace(/\bw\b(?=\s|$)/g, 'woman')
    .replace(/\bproline\b/g, 'line')
    .replace(/\bpro\s+line\b/g, 'line')
    .replace(/\b(hack|vertex|flow)\s+(\d)\b/g, '$1 0$2')
    .replace(/\b(hack|vertex|flow)(0[1-9])\b/g, '$1 $2')
    .replace(/\b(\d+)\.(\d+)\b/g, 'v$1p$2')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 || t === 'x' || /^\d$/.test(t))
    .filter(t =>
      KEEP_WORDS.has(t) ||
      (!STOP_WORDS.has(t) && (!/^\d+$/.test(t) || /^0[1-9]$/.test(t) || /^\d$/.test(t) || /^v\d+p\d+$/.test(t)))
    );
}

function extraerAnio(texto) {
  const m = texto.match(/\b(20(1[89]|2[0-9]))\b/);
  return m ? parseInt(m[1]) : null;
}

function extraerVersion(texto) {
  const sinAnio = texto.replace(/\b20\d{2}\b/g, '');
  const m = sinAnio.match(/\b(\d+\.\d+)\b/);
  return m ? m[1] : null;
}

// ─── Extracción de señales desde URL del producto ─────────────────────────────
// Las URLs de tiendas son estructuradas y más fiables que los títulos libres.
// PadelNuestro ejemplo: bullpadel-neuron-25-113768-p → año 2025
//                       bullpadel-drive-3-3-blue-2026-p → versión 3.3

function extraerAnioDeUrl(url) {
  if (!url) return null;

  // PadelPROShop usa -NNN al final del slug como codigo de anyo: 224=2024, 225=2025, 226=2026
  // Ej: padelproshop.com/products/pala-adidas-metalbone-carbon-ctrl-224
  // El sufijo -NNN NO es un numero de dos digitos, asi que el patron -2X- no lo captura.
  // Fix: detectarlo antes que el resto para devolver el anyo correcto.
  if (url.includes('padelproshop.com')) {
    const mPPS = url.match(/-(2\d{2})(?:[^\d]|$)/);
    if (mPPS) {
      const lastTwo = parseInt(mPPS[1]) % 100; // 224 % 100 = 24, 226 % 100 = 26
      const year = 2000 + lastTwo;
      if (year >= 2018 && year <= 2030) return year;
    }
  }

  // Sufijo de dos digitos tipo -25- o -26- que indican anyo (20XX)
  // Solo reconocemos 20-29 para no confundir con numeros de modelo
  const m = url.match(/[_-](2[0-9])[_-]/);
  if (m) {
    const year = 2000 + parseInt(m[1]);
    if (year >= 2018 && year <= 2030) return year;
  }
  // Tambien puede aparecer el anyo completo en la URL
  const mFull = url.match(/\b(20(1[89]|2[0-9]))\b/);
  return mFull ? parseInt(mFull[1]) : null;
}

// ─── Extrae números de generación (01-09) del slug de la URL ─────────────────
// Problema: Padel Coronado lista "Bullpadel Neuron 02" con title="Bullpadel Neuron"
// (sin "02"). El matcher solo ve "neuron" y elige Neuron 2025 (el más reciente
// sin "02" en tokens) en lugar de "Neuron 02 2026". La URL sí tiene "-02-" que
// identifica la generación. Este fix lo extrae y lo inyecta en los tokens del título.
//
// Solo extrae números 01-09 (generaciones como 02, 03, 04, 05...)
// NO extrae: años (20XX), IDs de producto (5+ dígitos), versiones X.Y (ya cubiertas)
//
// Ejemplos:
//   "pala-bullpadel-neuron-02/" → ["02"]
//   "bullpadel-vertex-04-hybrid" → ["04"]
//   "bullpadel-neuron-25-113768-p" → [] (25 no es 01-09, 113768 no es 01-09)
//   "head-extreme-pro-2026" → [] (sin generación)
function extraerGeneracionDeUrl(url) {
  if (!url) return [];
  const slug = (url.split('/').filter(Boolean).pop() ?? '')
    .replace(/[_-]/g, '-');
  // Extraer todos los fragmentos que son exactamente 01-09
  const parts = slug.split('-');
  return parts.filter(t => /^0[1-9]$/.test(t));
}

function extraerVersionDeUrl(url, anioTitulo) {
  if (!url) return null;
  // Patrón: -N-N- o _N_N_ donde N es un dígito (ej: drive-3-3, match-3-2)
  // Evitar confundir con SKUs numéricos al final tipo -113768-p
  const sinPath = url.split('/').pop() || url; // solo el slug final
  const m = sinPath.match(/[_-](\d)[_-](\d)[_-]/);
  if (!m) return null;
  const version = `${m[1]}.${m[2]}`;

  // Si el título tiene año explícito reciente (≥2025), la URL está reutilizada:
  // PadelNuestro mantiene slugs viejos (drive-3-3, match-3-2) para productos nuevos.
  // Priorizar el año del título sobre la versión del slug para no forzar
  // el match a palas antiguas (Drive 3.3 2023, Match 3.2 2023).
  if (anioTitulo !== null && anioTitulo >= 2025) return null;

  return version;
}

function extraerTokensModelo(modelo, marca) {
  const sinMarca = modelo.replace(new RegExp(`^${marca}\\s+`, 'i'), '');
  const sinAnio = sinMarca.replace(/\b20\d{2}\b/, '').trim();
  const sinJugador = sinAnio.replace(JUGADORES_PATTERN, '').trim();
  return tokenizar(sinJugador);
}

function normalize(str) {
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBrand(title, knownBrands) {
  const tl = normalize(title);
  const tokens = tl.split(/\s+/);
  for (const [key, val] of Object.entries(MARCAS_CONOCIDAS)) {
    if (key.includes(' ') && tl.includes(key)) return val;
  }
  for (const [key, val] of Object.entries(MARCAS_CONOCIDAS)) {
    if (!key.includes(' ') && tokens.includes(key)) return val;
  }
  for (const brand of knownBrands) {
    if (tl.includes(normalize(brand))) return brand;
  }
  return null;
}

// ─── Cache del catálogo ───────────────────────────────────────────────────────

let _catalogCache = null;
let _palasPorMarca = null;

async function getCatalog() {
  if (_catalogCache) return { catalog: _catalogCache, palasPorMarca: _palasPorMarca };

  const palas = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('palas')
      .select('id, modelo, marca, año')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    palas.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  _catalogCache = palas.map(p => ({
    ...p,
    tokens: extraerTokensModelo(p.modelo || '', p.marca || ''),
  }));

  _palasPorMarca = new Map();
  for (const p of _catalogCache) {
    const key = normalize(p.marca || '');
    if (!_palasPorMarca.has(key)) _palasPorMarca.set(key, []);
    _palasPorMarca.get(key).push(p);
  }

  return { catalog: _catalogCache, palasPorMarca: _palasPorMarca };
}

// ─── Matching principal ───────────────────────────────────────────────────────

async function fuzzyMatch(productTitle, productUrl) {
  const { catalog, palasPorMarca } = await getCatalog();
  const knownBrands = [...new Set(catalog.map(p => p.marca))];

  const brandDetected = extractBrand(productTitle, knownBrands);
  if (!brandDetected) {
    return { pala_id: null, confidence: 0, method: 'no_match' };
  }

  const brandKey = normalize(brandDetected);
  const candidates = palasPorMarca.get(brandKey) ?? [];
  if (candidates.length === 0) {
    return { pala_id: null, confidence: 0, method: 'no_match' };
  }

  const titleNorm = normalize(productTitle);
  let tokensTitle = tokenizar(titleNorm);
  const anioTitulo = extraerAnio(productTitle);
  const versionTitulo = extraerVersion(productTitle);

  // ── Señales de URL (más fiables que el título cuando hay conflicto) ────────
  const anioUrl = extraerAnioDeUrl(productUrl);
  const versionUrl = extraerVersionDeUrl(productUrl, anioTitulo);

  // ── Generación desde URL (01-09): Neuron 02, Vertex 04, Hack 03… ─────────
  // El title de tiendas a veces omite el número de generación aunque la URL sí lo tiene.
  // Ej: Padel Coronado title="Bullpadel Neuron", URL="/pala-bullpadel-neuron-02/"
  // Sin "02" en tokens el matcher elige el modelo más reciente sin generación (Neuron 2025)
  // en lugar del correcto (Neuron 02 2026). Inyectar "02" resuelve el desempate.
  const generacionUrl = extraerGeneracionDeUrl(productUrl);
  if (generacionUrl.length > 0) {
    const tituloSet = new Set(tokensTitle);
    const nuevos = generacionUrl.filter(g => !tituloSet.has(g));
    if (nuevos.length > 0) {
      console.log(`[fuzzy] 💡 Generación de URL inyectada: [${nuevos.join(', ')}] para "${productTitle}"`);
      tokensTitle = [...tokensTitle, ...nuevos];
    }
  }

  // El año efectivo es: URL (prioritario) > título
  const anioEfectivo = anioUrl ?? anioTitulo;
  // La versión efectiva es: URL (prioritario) > título
  const versionEfectiva = versionUrl ?? versionTitulo;

  if (anioUrl && anioUrl !== anioTitulo && anioTitulo !== null) {
    console.log(`[fuzzy] ⚠️  Conflicto año: título="${anioTitulo}" URL="${anioUrl}" → usando URL para "${productTitle}"`);
  }
  if (versionUrl && versionUrl !== versionTitulo && versionTitulo !== null) {
    console.log(`[fuzzy] ⚠️  Conflicto versión: título="${versionTitulo}" URL="${versionUrl}" → usando URL para "${productTitle}"`);
  }

  const difEnTitulo = new Set(tokensTitle.filter(t => TOKENS_DIFERENCIADORES.has(t)));

  // ── Fase estricta ────────────────────────────────────────────────────────
  let scored = candidates
    .map(pala => {
      if (pala.tokens.length === 0) return null;
      if (anioEfectivo !== null && pala.año !== anioEfectivo) return null;
      const missing = pala.tokens.filter(t => !tokensTitle.includes(t));
      if (missing.length > 0) return null;
      const difModelo = pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t));
      if (!difModelo.every(t => difEnTitulo.has(t))) return null;
      const difExtra = [...difEnTitulo].filter(d => !pala.tokens.includes(d));
      if (difExtra.length > 0) return null;
      return { pala, score: pala.tokens.length };
    })
    .filter(Boolean);

  // ── Sin año efectivo: reintentar sin restricción de año ──────────────────
  if (scored.length === 0 && anioEfectivo === null) {
    scored = candidates
      .map(pala => {
        if (pala.tokens.length === 0) return null;
        const missing = pala.tokens.filter(t => !tokensTitle.includes(t));
        if (missing.length > 0) return null;
        const difModelo = pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t));
        if (!difModelo.every(t => difEnTitulo.has(t))) return null;
        const difExtra = [...difEnTitulo].filter(d => !pala.tokens.includes(d));
        if (difExtra.length > 0) return null;
        return { pala, score: pala.tokens.length };
      })
      .filter(Boolean);
  }

  if (scored.length === 0) {
    const nearCandidates = candidates
      .map(pala => {
        if (pala.tokens.length === 0) return null;
        const matched = pala.tokens.filter(t => tokensTitle.includes(t));
        const ratio = matched.length / pala.tokens.length;
        if (ratio < 0.5) return null;
        return { id: pala.id, nombre: pala.modelo, score: ratio };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (nearCandidates.length > 0) {
      return { pala_id: null, confidence: nearCandidates[0].score, method: 'needs_claude', candidates: nearCandidates };
    }
    return { pala_id: null, confidence: 0, method: 'no_match' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DESEMPATES (orden crítico):
  //   1. Versión X.Y  (3.2 vs 3.3)
  //   2. Diferenciadores del título en el modelo  (team, carbon, black, blue…)
  //   3. Especificidad (nº tokens)
  //   4. Año más reciente
  // ─────────────────────────────────────────────────────────────────────────

  // ── Desempate 1: versión X.Y ──────────────────────────────────────────────
  if (versionEfectiva && scored.length > 1) {
    const conVersion = scored.filter(s => {
      const m = (s.pala.modelo || '').match(/\b(\d+\.\d+)\b/);
      return m && m[1] === versionEfectiva;
    });
    if (conVersion.length > 0 && conVersion.length < scored.length) scored = conVersion;
  }

  // ── Desempate 2: diferenciadores del título en el modelo ──────────────────
  if (difEnTitulo.size > 0 && scored.length > 1) {
    const difMatch = s => [...difEnTitulo].filter(d => s.pala.tokens.includes(d)).length;
    const maxDif = Math.max(...scored.map(difMatch));
    const top = scored.filter(s => difMatch(s) === maxDif);
    if (top.length > 0 && top.length < scored.length) scored = top;
  }

  // ── Desempate 3: más tokens (modelo más específico) ───────────────────────
  if (scored.length > 1) {
    const maxScore = Math.max(...scored.map(s => s.score));
    scored = scored.filter(s => s.score === maxScore);
  }

  // ── Desempate 4: año más reciente ────────────────────────────────────────
  if (scored.length > 1) {
    const maxAnio = Math.max(...scored.map(s => s.pala.año || 0));
    const top = scored.filter(s => s.pala.año === maxAnio);
    if (top.length > 0 && top.length < scored.length) scored = top;
  }

  if (scored.length === 1) {
    const winner = scored[0].pala;
    const confidence = anioEfectivo && anioEfectivo === winner.año ? 1.0 : 0.95;
    return { pala_id: winner.id, pala_nombre: winner.modelo, confidence, method: 'fuzzy' };
  }

  return {
    pala_id: null,
    confidence: 0.8,
    method: 'needs_claude',
    candidates: scored.map(s => ({ id: s.pala.id, nombre: s.pala.modelo, score: s.score / (scored[0]?.score || 1) })),
  };
}

module.exports = { fuzzyMatch, normalize, extractBrand };
