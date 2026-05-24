// scripts/prices/fuzzy-matcher.js
const { JaroWinklerDistance } = require('natural');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Token overlap: qué fracción de tokens del modelo aparecen en el título ──
// Útil cuando el título de tienda es largo pero contiene el modelo como substring.
// Ej: "Pala Bullpadel Hack 03 Power 2024 Negro" → tokens modelo ["hack","03","power"]
//     → 3/3 = 1.0 ✅
function tokenOverlap(titleNorm, modelNorm) {
  const titleTokens = new Set(titleNorm.split(' ').filter(t => t.length > 1));
  const modelTokens = modelNorm.split(' ').filter(t => t.length > 1);
  if (modelTokens.length === 0) return 0;
  const hits = modelTokens.filter(t => titleTokens.has(t)).length;
  return hits / modelTokens.length;
}

// ── Score combinado ──────────────────────────────────────────────────────────
// Jaro-Winkler captura similitud global; token-overlap captura "el modelo está
// contenido en el título". Usamos el máximo para no penalizar títulos largos.
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
    // Comparar contra modelo Y nombre — quedarnos con el mejor
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

module.exports = { fuzzyMatch, normalize };
