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
  return null
}

function normalizarTitulo(titulo) {
  return titulo
    .toLowerCase()
    .replace(/pala\s+(de\s+)?p[aá]del\s*/i, '')
    .replace(/\braqueta\b/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extraerCodigoModelo(texto) {
  // Extrae códigos tipo "03", "04", "v3", "pro", "elite", etc.
  const match = texto.match(/\b(v?\d{2}|pro|elite|carbon|control|attack|luxury|genius|ltd)\b/i);
  return match ? match[1].toLowerCase() : null;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function runMatcher(options = {}) {
  const dryRun = options.dryRun ?? false;
  const limit = options.limit ?? 500;

  console.log(`\n===== WALLAPOP MATCHER =====`);
  console.log(`Modo: ${dryRun ? 'DRY RUN' : 'ESCRITURA'} · Límite: ${limit}`);

  // Cargar catálogo completo
  const { data: palas, error: palasError } = await supabase
    .from('palas')
    .select('id, modelo, marca, año, precio_pvp');

  if (palasError || !palas) {
    console.error('Error cargando catálogo:', palasError?.message);
    return;
  }
  console.log(`Catálogo: ${palas.length} palas`);

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
      console.log(`[SIN AÑO] "${titulo}"`);
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

    let mejorMatch = null;
    let mejorScore = 0;

    for (const pala of palas) {
      const modeloNorm = normalizarTitulo(pala.modelo ?? '');
      let score = jaroWinkler(tituloNorm, modeloNorm);

      // Penalización si el código de modelo es distinto
      const codigoPala = extraerCodigoModelo(modeloNorm);
      if (codigoAnuncio && codigoPala && codigoAnuncio !== codigoPala) {
        score *= 0.80;
      }

      // Penalización si el año del anuncio no coincide con el año del catálogo
      const añoAnuncio = AÑOS.find(a => titulo.includes(a));
      if (añoAnuncio && pala.año && String(pala.año) !== añoAnuncio) {
        score *= 0.75;
      }

      if (score > mejorScore) {
        mejorScore = score;
        mejorMatch = pala;
      }
    }

    // ── 4. Decidir qué hacer con el score ───────────────────────────────────
    if (mejorScore >= 0.85 && mejorMatch) {
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
      // No escribimos pala_id — queda pendiente para claude-matcher
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

// Limpiar matches incorrectos primero (sin año o con match_method null)
async function limpiarMatchesSinAño() {
  console.log('Limpiando matches previos sin año en título...');
  
  const { data: conPalaId } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, pala_id')
    .not('pala_id', 'is', null);

  if (!conPalaId) return;

  let limpiados = 0;
  for (const item of conPalaId) {
    if (!tieneAño(item.title ?? '')) {
      limpiados++;
      if (!dryRun) {
        await supabase
          .from('wallapop_cache')
          .update({ pala_id: null, match_method: 'sin_año', match_confidence: 0 })
          .eq('external_id', item.external_id);
      }
    }
  }
  console.log(`Limpiados ${limpiados} matches sin año en título`);
}

limpiarMatchesSinAño()
  .then(() => runMatcher({ dryRun, limit }))
  .catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
  });