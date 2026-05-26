// scripts/prices/fuzzy-matcher.js
// v3 (2026-05-26):
//   FIX CRÍTICO: orden de desempates corregido.
//   El desempate por diferenciadores (Desempate 2) se movió ANTES del de
//   especificidad (Desempate 3). Con el orden anterior, "Adipower Team 2023"
//   y "Adipower 3.2 2023" empataban en tokens (3 vs 3) y ganaba el primero
//   en catálogo — incorrecto. Ahora el token "team" en el título prevalece
//   y selecciona "Adipower Team" sobre "Adipower 3.2".
//   Misma corrección resuelve Arrow Hit Carbon y Metalbone Carbon CTRL.
//
// v2 (2026-05-25) — reescrito desde cero, abandona Jaro-Winkler
//
// PROBLEMA DEL MATCHER ANTERIOR:
//   Jaro-Winkler mide similitud de caracteres, no de significado.
//   "Metalbone CTRL 3.3 2024" vs "Metalbone Youth 3.3 2024" → score 0.95 (aceptado, INCORRECTO).
//   "Hack 04 2026" vs "Hack 03 2022" → score 0.96 (aceptado, INCORRECTO).
//   No entiende que "Youth", "03 vs 04", "Soft vs Speed" diferencian productos distintos.
//
// SOLUCIÓN:
//   Sistema de tokens idéntico al de match-pala-id.ts (que funciona mejor).
//   Regla fundamental: TODOS los tokens del modelo deben estar en el título.
//   Tokens diferenciadores (ctrl, soft, speed, 03, 04...) son obligatorios.
//   Si hay ambigüedad → needs_claude, nunca asignar el más parecido.
//
// FLUJO:
//   1. Tokenizar título y modelo
//   2. Filtrar candidatos por marca
//   3. Fase estricta: todos los tokens del modelo en el título
//   4. Aplicar diferenciadores: si el título tiene "soft" y el modelo no → descartar
//   5. Desempate: versión X.Y → diferenciadores (ANTES de especificidad) → especificidad → año
//   6. Un único ganador → fuzzy (confidence = ratio tokens_match/tokens_modelo)
//      Varios → needs_claude con los candidatos
//      Ninguno → no_match

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// ─── Constantes (sincronizadas con match-pala-id.ts) ─────────────────────────

const STOP_WORDS = new Set([
  'de', 'da', 'del', 'la', 'el', 'y', 'e', 'con', 'para', 'pala', 'padel',
  'raqueta', 'serie', 'series', 'edition', 'version', 'by',
  'a22', 'a23', 'a24', 'rc',
]);

const KEEP_WORDS = new Set([
  'hrd', 'ctrl', 'soft', 'air', 'light', 'team', 'carbon',
  'match', 'drive', 'arrow', 'cross', 'hit', 'rx',
  '18k', '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena', 'hard',
  'pro', 'evo', 'plus', 'motion', 'elite', 'genius', 'attack',
  'lite', 'x', 'proplus', 'woman', 'sft', 'power', 'speed',
]);

const TOKENS_DIFERENCIADORES = new Set([
  'ctrl', 'carbon', 'team', 'hrd', 'light', 'soft', 'air',
  'pro', 'elite', 'attack', 'motion', 'drive', 'match',
  'arrow', 'cross', 'hit', 'rx', 'power', 'speed',
  '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena', 'sft',
  'hybrid', 'lite', 'x', 'proplus', 'woman',
  'extreme', 'vertex', 'hack', 'genius', 'viper',
  'zephyr', 'delta', 'flash', 'radical', 'instinct',
  'comfort', 'revolution', 'advance', 'jr',
  'st1', 'st2', 'st3', 'st4',
]);

// Jugadores — se eliminan del modelo al tokenizar, se usan para desempate
const JUGADORES_PATTERN = /\b(juan lebron|lebron|ale galan|ale gal[aá]n|martita ortega|alex ruiz|agust[ií]n tapia|arturo coello|paquito navarro|coki nieto|stupa|momo gonz[aá]lez|chingotto|franco chingotto|edu alonso|eduardo alonso)\b/gi;

// Marcas conocidas para detectar desde el título del producto
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
  // Alias de modelo → marca
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
  // Frases de dos palabras primero
  for (const [key, val] of Object.entries(MARCAS_CONOCIDAS)) {
    if (key.includes(' ') && tl.includes(key)) return val;
  }
  // Palabras sueltas
  for (const [key, val] of Object.entries(MARCAS_CONOCIDAS)) {
    if (!key.includes(' ') && tokens.includes(key)) return val;
  }
  // Fallback: marcas del catálogo
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

  // Pre-computar tokens de cada pala
  _catalogCache = palas.map(p => ({
    ...p,
    tokens: extraerTokensModelo(p.modelo || '', p.marca || ''),
  }));

  // Indexar por marca normalizada
  _palasPorMarca = new Map();
  for (const p of _catalogCache) {
    const key = normalize(p.marca || '');
    if (!_palasPorMarca.has(key)) _palasPorMarca.set(key, []);
    _palasPorMarca.get(key).push(p);
  }

  return { catalog: _catalogCache, palasPorMarca: _palasPorMarca };
}

// ─── Matching principal ───────────────────────────────────────────────────────

async function fuzzyMatch(productTitle) {
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

  // Diferenciadores presentes en el título (antes de inyecciones)
  const difEnTitulo = new Set(tokensTitle.filter(t => TOKENS_DIFERENCIADORES.has(t)));

  // ── Fase estricta: todos los tokens del modelo en el título ──────────────
  let scored = candidates
    .map(pala => {
      if (pala.tokens.length === 0) return null;
      // Año: si el título tiene año, debe coincidir
      if (anioTitulo !== null && pala.año !== anioTitulo) return null;
      // Todos los tokens del modelo deben estar en el título
      const missing = pala.tokens.filter(t => !tokensTitle.includes(t));
      if (missing.length > 0) return null;
      // Los diferenciadores del modelo deben estar en el título
      const difModelo = pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t));
      if (!difModelo.every(t => difEnTitulo.has(t))) return null;
      // Los diferenciadores del título no pueden apuntar a otro modelo
      const difExtra = [...difEnTitulo].filter(d => !pala.tokens.includes(d));
      if (difExtra.length > 0) return null;

      return { pala, score: pala.tokens.length };
    })
    .filter(Boolean);

  // ── Si fase estricta falla, intentar sin restricción de año ──────────────
  // (productos de tiendas a veces no tienen año en el título)
  if (scored.length === 0 && anioTitulo === null) {
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
    // ── Recopilar candidatos cercanos para needs_claude ──────────────────
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
      return {
        pala_id: null,
        confidence: nearCandidates[0].score,
        method: 'needs_claude',
        candidates: nearCandidates,
      };
    }
    return { pala_id: null, confidence: 0, method: 'no_match' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DESEMPATES — orden crítico:
  //   1. Versión X.Y   (ej: 3.2 vs 3.3 — el más preciso)
  //   2. Diferenciadores del título en el MODELO  ← MOVIDO AQUÍ (antes era Desempate 3)
  //      "Adipower Team 2023": team ∈ título → gana "Adipower Team" sobre "Adipower 3.2"
  //      "Arrow Hit Carbon": carbon ∈ título → gana "Arrow Hit Carbon" sobre "Arrow Hit"
  //   3. Especificidad (más tokens totales)
  //   4. Año más reciente
  // ─────────────────────────────────────────────────────────────────────────

  // ── Desempate 1: versión X.Y ──────────────────────────────────────────────
  if (versionTitulo && scored.length > 1) {
    const conVersion = scored.filter(s => {
      const m = (s.pala.modelo || '').match(/\b(\d+\.\d+)\b/);
      return m && m[1] === versionTitulo;
    });
    if (conVersion.length > 0 && conVersion.length < scored.length) scored = conVersion;
  }

  // ── Desempate 2: diferenciadores del título presentes en el MODELO ────────
  // FIX v3: movido ANTES de especificidad.
  // Cuando el título tiene "team" o "carbon", el candidato cuyo modelo
  // también los tiene debe ganar aunque ambos tengan el mismo nº de tokens.
  if (difEnTitulo.size > 0 && scored.length > 1) {
    const difMatch = s => [...difEnTitulo].filter(d => s.pala.tokens.includes(d)).length;
    const maxDif = Math.max(...scored.map(difMatch));
    const top = scored.filter(s => difMatch(s) === maxDif);
    if (top.length > 0 && top.length < scored.length) scored = top;
  }

  // ── Desempate 3: más tokens totales (modelo más específico) ──────────────
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

  // ── Resultado ────────────────────────────────────────────────────────────
  if (scored.length === 1) {
    const winner = scored[0].pala;
    const confidence = anioTitulo && anioTitulo === winner.año ? 1.0 : 0.95;
    return {
      pala_id: winner.id,
      pala_nombre: winner.modelo,
      confidence,
      method: 'fuzzy',
    };
  }

  // Ambigüedad — pasar a Claude con los candidatos
  return {
    pala_id: null,
    confidence: 0.8,
    method: 'needs_claude',
    candidates: scored.map(s => ({
      id: s.pala.id,
      nombre: s.pala.modelo,
      score: s.score / (scored[0]?.score || 1),
    })),
  };
}

module.exports = { fuzzyMatch, normalize, extractBrand };
