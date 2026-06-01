/**
 * scripts/embedding-rematch-daily.js
 *
 * Script diario (GitHub Actions) que aplica el embedding matcher a los anuncios
 * que el fuzzy matcher no pudo resolver (match_method = 'no_match' o 'ambiguous').
 *
 * No toca los anuncios con pala_id ya asignado — solo trabaja con los sin match.
 *
 * Uso:
 *   node scripts/embedding-rematch-daily.js
 *   node scripts/embedding-rematch-daily.js --dry-run
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { embeddingMatch } = require('./prices/embedding-matcher');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const DRY_RUN        = process.argv.includes('--dry-run');
const MIN_CONFIDENCE = 0.95;
const PAGE           = 1000;

async function main() {
  console.log('🧠 EMBEDDING REMATCH DIARIO');
  console.log(`📅 ${new Date().toISOString()}`);
  if (DRY_RUN) console.log('🔍 DRY RUN\n');

  // ── 1. Cargar items sin match ──────────────────────────────────────────────
  console.log('📦 Cargando items sin match (no_match + ambiguous)...');
  const items = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('wallapop_cache')
      .select('external_id, title, url')
      .is('pala_id', null)
      .or('match_method.eq.no_match,match_method.eq.ambiguous,match_method.is.null')
      .range(from, from + PAGE - 1);
    if (error) { console.error('Error:', error); process.exit(1); }
    if (!data || data.length === 0) break;
    items.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`📊 ${items.length} items a procesar\n`);

  if (items.length === 0) {
    console.log('✅ Nada que procesar.');
    return;
  }

  // ── 2. Matching con embeddings ─────────────────────────────────────────────
  let matches = 0, noMatch = 0, errores = 0;
  const updates = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (i % 500 === 0) {
      process.stdout.write(`\r⏳ ${i}/${items.length} (${Math.round(i/items.length*100)}%)...`);
    }

    try {
      const result = await embeddingMatch(item.title);
      if (result.pala_id && result.confidence >= MIN_CONFIDENCE) {
        matches++;
        updates.push({
          external_id:      item.external_id,
          pala_id:          result.pala_id,
          match_confidence: result.confidence,
          match_method:     'embedding_auto',
        });
      } else {
        noMatch++;
      }
    } catch (err) {
      errores++;
    }
  }

  console.log(`\n\n📊 Resultados:`);
  console.log(`  ✅ Matches encontrados: ${matches}`);
  console.log(`  ⚪ Sin match:           ${noMatch}`);
  console.log(`  ❌ Errores:             ${errores}\n`);

  if (updates.length === 0 || DRY_RUN) {
    if (DRY_RUN) console.log(`[DRY RUN] Se aplicarían ${updates.length} updates`);
    return;
  }

  // ── 3. Escribir en BD ─────────────────────────────────────────────────────
  console.log(`💾 Aplicando ${updates.length} matches...`);
  const BATCH = 50;
  let escritos = 0;

  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    await Promise.all(batch.map(u =>
      supabase
        .from('wallapop_cache')
        .update({
          pala_id:          u.pala_id,
          match_confidence: u.match_confidence,
          match_method:     u.match_method,
        })
        .eq('external_id', u.external_id)
    ));
    escritos += batch.length;
    process.stdout.write(`\r💾 ${escritos}/${updates.length}...`);
  }

  console.log(`\n✅ ${escritos} updates aplicados.`);
}

main().catch(err => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
