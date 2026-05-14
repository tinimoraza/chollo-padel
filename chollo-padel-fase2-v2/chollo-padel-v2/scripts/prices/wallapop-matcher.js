// scripts/prices/wallapop-matcher.js
// Linkea wallapop_cache.pala_id → palas.id usando fuzzy match Jaro-Winkler
// Uso: node scripts/prices/wallapop-matcher.js
// Opciones: --dry-run (no escribe en BD, solo muestra resultados)
//           --limit 100 (procesa solo N anuncios, útil para probar)

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { JaroWinklerDistance } = require('natural');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.indexOf('--limit');
const LIMIT = LIMIT_ARG !== -1 ? parseInt(process.argv[LIMIT_ARG + 1]) : null;

const SCORE_AUTO_MATCH = 0.85;   // match automático
const SCORE_MIN        = 0.60;   // por debajo → no match

// ─── Normalización ────────────────────────────────────────────────────────────

const MARCAS = [
  'bullpadel','nox','head','babolat','adidas','wilson','dunlop',
  'slazenger','royal padel','siux','vibora','varlion','star vie',
  'starvie','puma','drop shot','dropshot','softee','akkeron',
  'black crown','blackcrown','volt','hexer','kuikma','oxdog',
  'vairo','legend','prince','artengo','lotto','tecnifibre'
];

function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/pala\s+(de\s+)?p[aá]del\s*/gi, '')      // quita "pala de padel"
    .replace(/\b(nueva?|segunda\s+mano|sm|ocasion|oferta|outlet|pack|funda|regalada)\b/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extraerMarca(titulo) {
  const norm = normalizar(titulo);
  return MARCAS.find(m => norm.includes(m)) || null;
}

// ─── Carga palas de BD ────────────────────────────────────────────────────────

async function cargarPalas() {
  const { data, error } = await supabase
    .from('palas')
    .select('id, nombre, marca, modelo, año, brand_slug');

  if (error) throw new Error(`Error cargando palas: ${error.message}`);

  // Pre-normalizar para no repetir trabajo
  return data.map(p => ({
    ...p,
    _normalizado: normalizar(p.nombre || `${p.marca} ${p.modelo}`),
    _marca_norm: (p.marca || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  }));
}

// ─── Fuzzy match ──────────────────────────────────────────────────────────────

function fuzzyMatch(titulo, palas) {
  const tituloNorm = normalizar(titulo);
  const marcaDetectada = extraerMarca(titulo);

  // Filtrar por marca si la detectamos (reduce falsos positivos enormemente)
  const candidatos = marcaDetectada
    ? palas.filter(p => p._marca_norm.includes(marcaDetectada) || marcaDetectada.includes(p._marca_norm))
    : palas;

  if (candidatos.length === 0) return null;

  let mejorScore = 0;
  let mejorPala = null;

  for (const pala of candidatos) {
    const score = JaroWinklerDistance(tituloNorm, pala._normalizado);
    if (score > mejorScore) {
      mejorScore = score;
      mejorPala = pala;
    }
  }

  if (mejorScore >= SCORE_AUTO_MATCH) {
    return { pala: mejorPala, confidence: mejorScore, method: 'fuzzy_auto' };
  }
  if (mejorScore >= SCORE_MIN) {
    return { pala: mejorPala, confidence: mejorScore, method: 'fuzzy_low' };
  }
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🎯 WallapopMatcher${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log('─'.repeat(50));

  // 1. Cargar palas
  console.log('📦 Cargando palas de BD...');
  const palas = await cargarPalas();
  console.log(`   ${palas.length} palas cargadas`);

  // 2. Cargar anuncios sin pala_id (o todos si --force)
  console.log('🔍 Cargando anuncios Wallapop sin matchear...');
  let query = supabase
    .from('wallapop_cache')
    .select('external_id, title, price')
    .is('pala_id', null)
    .not('title', 'is', null)
    .order('scraped_at', { ascending: false });

  if (LIMIT) query = query.limit(LIMIT);

  const { data: anuncios, error: errAnuncios } = await query;
  if (errAnuncios) throw new Error(`Error cargando anuncios: ${errAnuncios.message}`);
  console.log(`   ${anuncios.length} anuncios por procesar\n`);

  // 3. Procesar
  const stats = { total: 0, auto: 0, low: 0, noMatch: 0, errores: 0 };
  const updates = [];

  for (const anuncio of anuncios) {
    stats.total++;
    const resultado = fuzzyMatch(anuncio.title, palas);

    if (!resultado) {
      stats.noMatch++;
      if (DRY_RUN) console.log(`  ❌ NO MATCH  | ${anuncio.title.substring(0, 60)}`);
      continue;
    }

    const { pala, confidence, method } = resultado;

    if (method === 'fuzzy_auto') stats.auto++;
    else stats.low++;

    if (DRY_RUN) {
      const icon = method === 'fuzzy_auto' ? '✅' : '🟡';
      console.log(`  ${icon} ${(confidence * 100).toFixed(0)}% | ${anuncio.title.substring(0, 45).padEnd(45)} → ${pala.nombre}`);
    } else {
      // Solo guardamos los matches seguros (fuzzy_auto)
      if (method === 'fuzzy_auto') {
        updates.push({
          external_id: anuncio.external_id,
          pala_id: pala.id,
          match_confidence: confidence,
          match_method: method
        });
      }
    }
  }

  // 4. Escribir en BD — UPDATE por external_id, nunca upsert
  //    Así solo toca pala_id/match_confidence/match_method, sin rozar title ni otros campos
  if (!DRY_RUN && updates.length > 0) {
    console.log(`\n💾 Guardando ${updates.length} matches seguros en BD...`);
    const BATCH = 50;
    let guardados = 0;

    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);

      // UPDATE individual por external_id para evitar el not-null constraint de upsert
      const promises = batch.map(u =>
        supabase
          .from('wallapop_cache')
          .update({
            pala_id: u.pala_id,
            match_confidence: u.match_confidence,
            match_method: u.match_method
          })
          .eq('external_id', u.external_id)
      );

      const results = await Promise.all(promises);
      const erroresBatch = results.filter(r => r.error);

      if (erroresBatch.length > 0) {
        console.error(`  ❌ ${erroresBatch.length} errores en batch ${i}-${i + BATCH}:`, erroresBatch[0].error.message);
        stats.errores += erroresBatch.length;
        guardados += batch.length - erroresBatch.length;
      } else {
        guardados += batch.length;
      }

      process.stdout.write(`  ✅ ${guardados}/${updates.length}\r`);
    }
    console.log('');
  }

  // 5. Resumen
  const matchRate = ((stats.auto + stats.low) / stats.total * 100).toFixed(1);
  console.log('\n📊 RESUMEN');
  console.log('─'.repeat(50));
  console.log(`  Total anuncios:    ${stats.total}`);
  console.log(`  ✅ Match seguro:   ${stats.auto} (score ≥ 0.85) → escritos en BD`);
  console.log(`  🟡 Match bajo:     ${stats.low} (score 0.60-0.85) → pendiente Sprint 2`);
  console.log(`  ❌ Sin match:      ${stats.noMatch}`);
  console.log(`  📈 Match rate:     ${matchRate}%`);
  if (stats.errores > 0) console.log(`  ⚠️  Errores BD:    ${stats.errores}`);
  console.log('');

  if (DRY_RUN) {
    console.log('ℹ️  Dry run — no se ha escrito nada en BD');
    console.log('   Quita --dry-run para guardar los matches\n');
  }
}

main().catch(err => {
  console.error('💥 Error fatal:', err.message);
  process.exit(1);
});
