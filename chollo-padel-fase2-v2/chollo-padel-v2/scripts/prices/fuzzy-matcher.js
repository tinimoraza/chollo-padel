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
    const target = normalize(pala.modelo || pala.nombre);
    const score = JaroWinklerDistance(normalized, target);
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
        .map(p => ({
          id: p.id,
          nombre: p.nombre,
          score: JaroWinklerDistance(normalized, normalize(p.modelo || p.nombre))
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
    };
  }

  return { pala_id: null, confidence: bestScore, method: 'no_match' };
}

module.exports = { fuzzyMatch, normalize };