// scripts/prices/fuzzy-matcher.js
const { JaroWinklerDistance } = require('natural');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// Colores y palabras decorativas que aparecen en títulos de tienda pero no en BD
const COLOR_WORDS = [
  'negro','negra','blanco','blanca','rojo','roja','azul','verde','amarillo',
  'naranja','rosa','morado','gris','beige','turquesa','fluor','flúor',
  'celeste','dorado','plateado','marron','lila','coral',
  'black','white','red','blue','green','lime','grey','gray',
  'edicion','limitada','limited','edition','padel','pala','de',
]

function normalize(str) {
  let s = str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Año corto → año completo: "25" → "2025", "26" → "2026", etc.
  s = s.replace(/\b(2[2-9])\b/g, '20$1')

  // Eliminar colores y palabras decorativas
  s = s.split(' ').filter(t => !COLOR_WORDS.includes(t)).join(' ').replace(/\s+/g, ' ').trim()

  return s
}

// Token overlap: qué fracción de tokens del modelo aparecen en el título
function tokenOverlap(titleNorm, modelNorm) {
  const titleTokens = new Set(titleNorm.split(' ').filter(t => t.length > 1));
  const modelTokens = modelNorm.split(' ').filter(t => t.length > 1);
  if (modelTokens.length === 0) return 0;
  const hits = modelTokens.filter(t => titleTokens.has(t)).length;
  return hits / modelTokens.length;
}

// Score combinado: máximo entre Jaro-Winkler y token-overlap
function combinedScore(titleNorm, targetNorm) {
  const jw = JaroWinklerDistance(titleNorm, targetNorm);
  const to = tokenOverlap(titleNorm, targetNorm);
  return Math.max(jw, to);
}

function extractBrand(title, knownBrands) {
  const normalized = normalize(title);
  for (const brand of knownBrands) {
    if (normalized.includes(normalize(brand))) {
      return normalize(brand);
    }
  }
  return null;
}

async function fuzzyMatch(productTitle) {
  const normalized = normalize(productTitle);

  if (!fuzzyMatch._cache) {
    const { data, error } = await supabase
      .from('palas')
      .select('id, nombre, modelo, marca, año, precio_pvp');
    if (error) throw error;
    fuzzyMatch._cache = data;
  }

  const palas = fuzzyMatch._cache;
  const knownBrands = [...new Set(palas.map(p => p.marca))];
  const detectedBrand = extractBrand(productTitle, knownBrands);

  const candidates = detectedBrand
    ? palas.filter(p => normalize(p.marca) === detectedBrand)
    : palas;

  let bestMatch = null;
  let bestScore = 0;

  for (const pala of candidates) {
    const targetModelo = normalize(pala.modelo || '');
    const targetNombre = normalize(pala.nombre || '');
    const score = Math.max(
      targetModelo ? combinedScore(normalized, targetModelo) : 0,
      targetNombre ? combinedScore(normalized, targetNombre) : 0,
    );
    if (score > bestScore) {
      bestScore = score;
      bestMatch = pala;
    }
  }

  if (bestScore >= 0.85) {
    return {
      pala_id: bestMatch.id,
      pala_nombre: bestMatch.nombre,
      confidence: bestScore,
      method: 'fuzzy'
    };
  }

  if (bestScore >= 0.60) {
    return {
      pala_id: null,
      confidence: bestScore,
      method: 'needs_claude',
      candidates: candidates
        .map(p => {
          const tM = normalize(p.modelo || '');
          const tN = normalize(p.nombre || '');
          return {
            id: p.id,
            nombre: p.nombre,
            score: Math.max(
              tM ? combinedScore(normalized, tM) : 0,
              tN ? combinedScore(normalized, tN) : 0,
            )
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
    };
  }

  return { pala_id: null, confidence: bestScore, method: 'no_match' };
}

module.exports = { fuzzyMatch, normalize, extractBrand };
