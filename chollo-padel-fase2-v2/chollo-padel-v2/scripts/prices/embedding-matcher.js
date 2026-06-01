/**
 * scripts/prices/embedding-matcher.js
 *
 * Matcher semántico basado en embeddings como alternativa al fuzzy-matcher
 * para casos que éste no puede resolver (no_match o confidence ambigua).
 *
 * Flujo:
 *   1. Extrae marca del título
 *   2. Filtra candidatos del catálogo por marca
 *   3. Genera embedding del título normalizado
 *   4. Cosine similarity contra embeddings pre-computados
 *   5. Si el mejor candidato supera el umbral → match
 *
 * Los embeddings del catálogo se pre-computan con:
 *   node scripts/generate-catalog-embeddings.js
 * y se leen desde scripts/data/catalog-embeddings.json
 */

const fs   = require('fs');
const path = require('path');
const { extractBrand, normalize } = require('./fuzzy-matcher');

const EMBEDDINGS_PATH  = path.join(__dirname, '..', 'data', 'catalog-embeddings.json');
const MODEL_NAME       = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const SIMILARITY_THRESHOLD = 0.82;  // por debajo → no_match

// Misma normalización que generate-catalog-embeddings.js
const JUGADORES_RE = /\b(juan lebron|lebron|ale galan|ale galán|martita ortega|alex ruiz|agustín tapia|agustin tapia|arturo coello|paquito navarro|coki nieto|stupa|momo gonzalez|momo gonzález|chingotto|franco chingotto|edu alonso|eduardo alonso|lucia sainz|lucía sainz|maxi sanchez|maxi sánchez|berto trabanco|jose diestro|josé diestro)\b/gi;

function normalizarTitulo(titulo, marca) {
  return titulo
    .replace(new RegExp(marca, 'gi'), '')            // quitar marca
    .replace(/\b(pala|padel|pádel|raqueta|racket|racchetta|raquette|de|da|del|para|adulto|adulte|adult)\b/gi, '')
    .replace(/\b20\d{2}\b/g, '')                     // quitar año
    .replace(JUGADORES_RE, '')                        // quitar jugadores
    .replace(/\b(ltd|ltde|edición|edition|edt|nueva|nuevo|nuova|neuf|new)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Estado del módulo (lazy-load) ──────────────────────────────────────────

let _embedder   = null;
let _catalog    = null;
let _byMarca    = null;

async function getEmbedder() {
  if (_embedder) return _embedder;
  const { pipeline } = await import('@xenova/transformers');
  _embedder = await pipeline('feature-extraction', MODEL_NAME);
  return _embedder;
}

function getCatalog() {
  if (_catalog) return { catalog: _catalog, byMarca: _byMarca };

  if (!fs.existsSync(EMBEDDINGS_PATH)) {
    throw new Error(
      `No se encuentran los embeddings del catálogo en ${EMBEDDINGS_PATH}.\n` +
      `Genera con: node scripts/generate-catalog-embeddings.js`
    );
  }

  _catalog = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf8'));

  // Índice por marca normalizada
  _byMarca = new Map();
  for (const [id, entry] of Object.entries(_catalog)) {
    const key = normalize(entry.marca || '');
    if (!_byMarca.has(key)) _byMarca.set(key, []);
    _byMarca.get(key).push({ id, ...entry });
  }

  return { catalog: _catalog, byMarca: _byMarca };
}

/**
 * Intenta matchear un título usando embeddings.
 * @param {string} titulo  - Título del anuncio de Wallapop/Vinted
 * @param {string[]} [marcasBrands] - Lista de marcas conocidas (para extractBrand)
 * @returns {{ pala_id, confidence, method, pala_nombre } | { pala_id: null, confidence: 0, method: 'no_match' }}
 */
async function embeddingMatch(titulo, knownBrands = []) {
  const { byMarca } = getCatalog();

  // ── Detectar marca ─────────────────────────────────────────────────────────
  const marca = extractBrand(titulo, knownBrands);
  if (!marca) {
    return { pala_id: null, confidence: 0, method: 'no_match_brand' };
  }

  const candidatos = byMarca.get(normalize(marca)) ?? [];
  if (candidatos.length === 0) {
    return { pala_id: null, confidence: 0, method: 'no_match_brand' };
  }

  // ── Normalizar título y generar embedding ──────────────────────────────────
  const textoNorm = normalizarTitulo(titulo, marca);
  if (!textoNorm || textoNorm.length < 2) {
    return { pala_id: null, confidence: 0, method: 'no_match_empty' };
  }

  const embedder = await getEmbedder();
  const output   = await embedder([textoNorm], { pooling: 'mean', normalize: true });
  const vector   = Array.from(output[0].data);

  // ── Cosine similarity contra todos los candidatos de la marca ─────────────
  let bestId    = null;
  let bestName  = null;
  let bestScore = -1;
  let secondScore = -1;

  for (const cand of candidatos) {
    const sim = cosineSimilarity(vector, cand.vector);
    if (sim > bestScore) {
      secondScore = bestScore;
      bestScore   = sim;
      bestId      = cand.id;
      bestName    = cand.nombre;
    } else if (sim > secondScore) {
      secondScore = sim;
    }
  }

  if (bestScore < SIMILARITY_THRESHOLD) {
    return { pala_id: null, confidence: bestScore, method: 'no_match_low_sim' };
  }

  // Si el segundo candidato está muy cerca → match ambiguo → bajar confidence
  const gap = bestScore - secondScore;
  const confidence = gap < 0.03
    ? Math.round(bestScore * 0.88 * 100) / 100   // ambiguo → reducir confidence
    : Math.round(bestScore * 100) / 100;

  return {
    pala_id:     bestId,
    pala_nombre: bestName,
    confidence,
    method:      'embedding',
    similarity:  Math.round(bestScore * 1000) / 1000,
    gap:         Math.round(gap * 1000) / 1000,
  };
}

module.exports = { embeddingMatch };
