// scripts/prices/wallapop-matcher.js
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');
const jaroWinkler = require('jaro-winkler');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// ── Helpers ────────────────────────────────────────────────────────────────────

const AÑOS = ['2020', '2021', '2022', '2023', '2024', '2025', '2026'];

function tieneAño(titulo) {
  return AÑOS.some(a => titulo.includes(a));
}

function motivoDescarte(titulo) {
  const t = titulo.toLowerCase();
  if (/paletero|funda|mochila|bolsa|grip|overgrip|protector|muñequera/.test(t)) return 'accesorio';
  if (/pack|kit|lote|conjunto/.test(t)) return 'pack';
  if (/tenis|tennis|squash|bádminton|badminton/.test(t)) return 'otro_deporte';
  if (/zapatill|shoe|sneaker/.test(t)) return 'zapatilla';
  if (/raqueta/.test(t) && !/pala|padel|pádel/.test(t)) return 'raqueta_tenis';
  return null;
}

function normalizarTitulo(titulo) {
  return titulo
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/pala\s+(de\s+)?p[aá]del\s*/i, '')
    .replace(/\braqueta\b/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extraerCodigoModelo(texto) {
  const match = texto.match(/\b(v?\d{2}|pro|elite|carbon|control|attack|luxury|genius|ltd)\b/i);
  return match ? match[1].toLowerCase() : null;
}

// Aliases de marcas: variantes que aparecen en títulos de wallapop
const MARCA_ALIASES = {
  'bullpadel':  ['bullpadel', 'bull padel'],
  'nox':        ['nox'],
  'head':       ['head'],
  'babolat':    ['babolat'],
  'adidas':     ['adidas'],
  'wilson':     ['wilson'],
  'siux':       ['siux'],
  'dunlop':     ['dunlop'],
  'varlion':    ['varlion'],
  'vibora':     ['vibora', 'vibor-a', 'vibor a'],
  'star vie':   ['star vie', 'starvie'],
  'drop shot':  ['drop shot', 'dropshot'],
  'royal padel':['royal padel', 'royalpadel'],
  'black crown':['black crown', 'blackcrown'],
  'kuikma':     ['kuikma', 'decathlon'],
  'joma':       ['joma'],
  'oxdog':      ['oxdog'],
  'alkemia':    ['alkemia'],
  'puma':       ['puma'],
};

/**
 * Devuelve true si la marca del catálogo aparece en el título normalizado.
 * Evita matches cross-brand (Wilson → Adidas, Joma → Nox, etc.)
 */
function marcaEnTitulo(marcaCatalogo, tituloNorm) {
  if (!marcaCatalogo) return true; // sin marca → no filtrar
  const marcaKey = marcaCatalogo.toLowerCase().trim();
  const aliases = MARCA_ALIASES[marcaKey] ?? [marcaKey];
  return aliases.some(alias => tituloNorm.includes(alias));
}

/**
 * Scoring híbrido: solapamiento de palabras + jaro-winkler truncado.
 *
 * El problema con jaro-winkler sobre strings completos es que penaliza
 * la diferencia de longitud. Un título de wallapop tiene palabras extra
 * al final ("nueva sin estrenar", "buen estado", etc.) que bajan el score.
 *
 * Estrategia:
 * 1. wordOverlap: qué % de las palabras del modelo aparecen en el título.
 *    Si el modelo entero está contenido → 1.0.
 * 2. jaroTruncado: jaro-winkler entre el modelo y los primeros N tokens
 *    del título (N = nº de tokens del modelo), eliminando ruido del final.
 * 3. score final = max(wordOverlap, jaroTruncado)
 */
function scoreModelo(tituloNorm, modeloNorm) {
  const tituloTokens = new Set(tituloNorm.split(' '));
  const modeloTokens = modeloNorm.split(' ').filter(Boolean);

  if (modeloTokens.length === 0) return 0;

  // 1. Word overlap
  const matched = modeloTokens.filter(t => tituloTokens.has(t)).length;
  const wordOverlap = matched / modeloTokens.length;

  // 2. Jaro-winkler truncado: comparar modelo contra los primeros N words del título
  const tituloTruncado = tituloNorm.split(' ').slice(0, modeloTokens.length).join(' ');
  const jaroTrunc = jaroWinkler(modeloNorm, tituloTruncado);

  return Math.max(wordOverlap, jaroTrunc);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function runMatcher(options = {}) {
  const dryRun = options.dryRun ?? false;
  const limit = options.limit ?? 500;

  console.log(`\n===== WALLAPOP MATCHER =====`);
  console.log(`Modo: ${dryRun ? 'DRY RUN' : 'ESCRITURA'} · Límite: ${limit}`);

  // Cargar catálogo completo (sin limit — son ~1417 palas, caben bien en memoria)
  const { data: palas, error: palasError } = await supabase
    .from('palas')
    .select('id, modelo, marca, año, precio_pvp');

  if (palasError || !palas) {
    console.error('Error cargando catálogo:', palasError?.message);
    return;
  }
  console.log(`Catálogo: ${palas.length} palas`);

  // Pre-normalizar modelos del catálogo (evita re-calcular en el bucle interno)
  const palasNorm = palas.map(p => ({
    ...p,
    modeloNorm: normalizarTitulo(p.modelo ?? ''),
    codigoModelo: extraerCodigoModelo(normalizarTitulo(p.modelo ?? '')),
  }));

  // Anuncios sin pala_id
  const { data: anuncios, error: anunciosError } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, price, condition')
    .is('pala_id', null)
    .limit(limit);

  if (anunciosError || !anuncios) {
    console.error('Error cargando anuncios:', anunciosError?.message);
    return;
  }
  console.log(`Anuncios sin match: ${anuncios.length}`);

  let matchesAuto = 0;
  let matchesLow = 0;
  let descartados = 0;
  let sinAño = 0;
  let sinMatch = 0;

  for (const anuncio of anuncios) {
    const titulo = anuncio.title ?? '';

    // ── 1. Descartar accesorios, packs, otros deportes ──────────────────────
    const motivo = motivoDescarte(titulo);
    if (motivo) {
      descartados++;
      if (!dryRun) {
        await supabase
          .from('wallapop_cache')
          .update({ match_method: 'descartado', match_confidence: 0 })
          .eq('external_id', anuncio.external_id);
      }
      continue;
    }

    // ── 2. Descartar si no tiene año en el título ────────────────────────────
    if (!tieneAño(titulo)) {
      sinAño++;
      if (!dryRun) {
        await supabase
          .from('wallapop_cache')
          .update({ match_method: 'sin_año', match_confidence: 0 })
          .eq('external_id', anuncio.external_id);
      }
      continue;
    }

    // ── 3. Fuzzy match contra catálogo ───────────────────────────────────────
    const tituloNorm = normalizarTitulo(titulo);
    const codigoAnuncio = extraerCodigoModelo(tituloNorm);
    const añoAnuncio = AÑOS.find(a => titulo.includes(a));

    let mejorMatch = null;
    let mejorScore = 0;

    for (const pala of palasNorm) {
      // Descarte duro: año incorrecto
      if (añoAnuncio && pala.año && String(pala.año) !== añoAnuncio) continue;

      // Descarte duro: marca no aparece en el título (evita cross-brand falsos)
      if (!marcaEnTitulo(pala.marca, tituloNorm)) continue;

      let score = scoreModelo(tituloNorm, pala.modeloNorm);

      // Penalización si el código de modelo es distinto
      if (codigoAnuncio && pala.codigoModelo && codigoAnuncio !== pala.codigoModelo) {
        score *= 0.80;
      }

      if (score > mejorScore) {
        mejorScore = score;
        mejorMatch = pala;
      }
    }

    // ── 4. Decidir qué hacer con el score ───────────────────────────────────
    // Umbral bajado a 0.80 (seguro ahora que el filtro de marca elimina falsos)
    if (mejorScore >= 0.80 && mejorMatch) {
      matchesAuto++;
      console.log(`[AUTO ${mejorScore.toFixed(2)}] "${titulo}" → ${mejorMatch.modelo}`);
      if (!dryRun) {
        await supabase
          .from('wallapop_cache')
          .update({
            pala_id: mejorMatch.id,
            match_confidence: mejorScore,
            match_method: 'fuzzy_auto',
          })
          .eq('external_id', anuncio.external_id);
      }
    } else if (mejorScore >= 0.60 && mejorMatch) {
      matchesLow++;
      console.log(`[LOW  ${mejorScore.toFixed(2)}] "${titulo}" → ${mejorMatch.modelo}`);
    } else {
      sinMatch++;
      console.log(`[MISS ${mejorScore.toFixed(2)}] "${titulo}"`);
    }
  }

  console.log(`\n===== RESULTADO =====`);
  console.log(`Auto matches:  ${matchesAuto}`);
  console.log(`Low matches:   ${matchesLow}`);
  console.log(`Sin año:       ${sinAño}`);
  console.log(`Descartados:   ${descartados}`);
  console.log(`Sin match:     ${sinMatch}`);
}

// ── CLI ────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 500;

// Limpiar matches incorrectos (sin año en título o con año incorrecto vs catálogo)
async function limpiarMatchesSinAño() {
  console.log('Limpiando matches previos con año incorrecto...');

  const { data: conPalaId } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, pala_id')
    .not('pala_id', 'is', null);

  if (!conPalaId) return;

  const { data: palas } = await supabase
    .from('palas')
    .select('id, año');
  const palaAñoMap = Object.fromEntries((palas ?? []).map(p => [p.id, p.año]));

  let limpiados = 0;
  for (const item of conPalaId) {
    const titulo = item.title ?? '';
    const sinAño = !tieneAño(titulo);
    const añoAnuncio = AÑOS.find(a => titulo.includes(a));
    const añoPala = palaAñoMap[item.pala_id];
    const añoIncorrecto = añoAnuncio && añoPala && String(añoPala) !== añoAnuncio;

    if (sinAño || añoIncorrecto) {
      limpiados++;
      const method = sinAño ? 'sin_año' : 'año_incorrecto';
      console.log(`[LIMPIA ${method}] "${titulo}"`);
      if (!dryRun) {
        await supabase
          .from('wallapop_cache')
          .update({ pala_id: null, match_method: method, match_confidence: 0 })
          .eq('external_id', item.external_id);
      }
    }
  }
  console.log(`Limpiados ${limpiados} matches incorrectos`);
}

limpiarMatchesSinAño()
  .then(() => runMatcher({ dryRun, limit }))
  .catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
  });
