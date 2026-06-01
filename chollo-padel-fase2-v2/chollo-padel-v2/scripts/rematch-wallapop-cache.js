/**
 * scripts/rematch-wallapop-cache.js
 *
 * Resetea y re-matchea todas las entradas de wallapop_cache que tienen:
 *   - pala_id asignado con match_confidence NULL (matches históricos sin confidence)
 *   - pala_id asignado con match_confidence < 0.95 (matches de baja confianza)
 *   - pala_id NULL (nunca matcheados)
 *
 * Para cada entrada:
 *   - Si nuevo match >= 0.95 → actualiza pala_id + match_confidence
 *   - Si nuevo match < 0.95 o no hay match → pala_id = NULL, match_confidence = NULL
 *
 * Al final recalcula price_reference para todas las palas afectadas.
 *
 * Uso:
 *   node scripts/rematch-wallapop-cache.js
 *   node scripts/rematch-wallapop-cache.js --solo-malos   (solo NULL + <0.95, no retoca los buenos)
 *   node scripts/rematch-wallapop-cache.js --dry-run      (no escribe en BD, solo muestra stats)
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { fuzzyMatch } = require('./prices/fuzzy-matcher');
const { recalculatePriceReference } = require('./prices/pipeline');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const DRY_RUN   = process.argv.includes('--dry-run');
const SOLO_MALOS = process.argv.includes('--solo-malos');
const BATCH_SIZE = 200;
const MIN_CONFIDENCE = 0.95;

// ─── Contadores ────────────────────────────────────────────────────────────────
const stats = {
  total:          0,
  mejorados:      0,   // tenían mal match → ahora tienen bueno
  mantenidos:     0,   // tenían buen match → confirmado
  nullificados:   0,   // tenían match → ahora sin match (ambiguo o incorrecto)
  sinMatch:       0,   // no tenían match → siguen sin él
  nuevosMatches:  0,   // no tenían match → ahora tienen uno bueno
  errores:        0,
};

async function main() {
  console.log('🔄 REMATCH WALLAPOP CACHE');
  console.log(`📅 ${new Date().toISOString()}`);
  if (DRY_RUN)    console.log('🔍 DRY RUN — no se escribirá en la BD');
  if (SOLO_MALOS) console.log('⚙️  Modo: solo procesa entradas con match malo o sin match');
  console.log('');

  // ── 1. Cargar entradas a procesar ──────────────────────────────────────────
  console.log('📦 Cargando entradas de wallapop_cache...');

  let query = supabase
    .from('wallapop_cache')
    .select('external_id, title, url, platform, match_confidence, pala_id');

  if (SOLO_MALOS) {
    // Solo entradas con match malo (NULL confidence o < 0.95) o sin match
    // No tocamos las que ya tienen confidence >= 0.95 (son las buenas del pipeline nuevo)
    query = query.or('pala_id.is.null,match_confidence.is.null,match_confidence.lt.0.95');
  }

  // Paginar para no cargar 23K de golpe
  const PAGE = 1000;
  let allItems = [];
  let from = 0;
  while (true) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) { console.error('Error cargando wallapop_cache:', error); process.exit(1); }
    if (!data || data.length === 0) break;
    allItems.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  stats.total = allItems.length;
  console.log(`📊 ${stats.total} entradas a procesar\n`);

  if (stats.total === 0) {
    console.log('✅ Nada que procesar.');
    return;
  }

  // ── 2. Procesar en batches ──────────────────────────────────────────────────
  const palaIdsAfectadas = new Set();
  const updates = []; // { external_id, pala_id, match_confidence }

  for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    const batch = allItems.slice(i, i + BATCH_SIZE);
    const pct = Math.round(((i + batch.length) / allItems.length) * 100);
    process.stdout.write(`\r⏳ Procesando ${i + batch.length}/${allItems.length} (${pct}%)...`);

    for (const item of batch) {
      try {
        const result = await fuzzyMatch(item.title, item.url || null);

        const teniaBuenMatch = item.pala_id && item.match_confidence >= MIN_CONFIDENCE;
        const nuevoMatchBueno = result.pala_id && result.confidence >= MIN_CONFIDENCE;

        if (nuevoMatchBueno) {
          if (!item.pala_id) {
            stats.nuevosMatches++;
          } else if (item.pala_id !== result.pala_id) {
            stats.mejorados++;
          } else {
            stats.mantenidos++;
          }

          updates.push({
            external_id:       item.external_id,
            pala_id:           result.pala_id,
            match_confidence:  result.confidence,
          });

          palaIdsAfectadas.add(result.pala_id);
          if (item.pala_id && item.pala_id !== result.pala_id) {
            palaIdsAfectadas.add(item.pala_id); // recalcular la pala que pierde el match
          }

        } else {
          // No hay match bueno → nullificar
          if (item.pala_id) {
            stats.nullificados++;
            palaIdsAfectadas.add(item.pala_id); // recalcular esta pala
          } else {
            stats.sinMatch++;
          }

          updates.push({
            external_id:      item.external_id,
            pala_id:          null,
            match_confidence: null,
          });
        }

      } catch (err) {
        console.error(`\nError en "${item.title}": ${err.message}`);
        stats.errores++;
      }
    }
  }

  console.log('\n');

  // ── 3. Escribir updates en BD ───────────────────────────────────────────────
  if (!DRY_RUN) {
    console.log(`💾 Escribiendo ${updates.length} updates en wallapop_cache...`);
    const WRITE_BATCH = 100;
    let escritos = 0;
    for (let i = 0; i < updates.length; i += WRITE_BATCH) {
      const batch = updates.slice(i, i + WRITE_BATCH);
      // Upsert en lote — wallapop_cache tiene external_id como PK
      const { error } = await supabase
        .from('wallapop_cache')
        .upsert(
          batch.map(u => ({
            external_id:      u.external_id,
            pala_id:          u.pala_id,
            match_confidence: u.match_confidence,
          })),
          { onConflict: 'external_id' }
        );
      if (error) {
        console.error(`Error escribiendo batch ${i}-${i + WRITE_BATCH}:`, error.message);
      } else {
        escritos += batch.length;
      }
      process.stdout.write(`\r💾 Escritos ${escritos}/${updates.length}...`);
    }
    console.log('\n');
  } else {
    console.log(`[DRY RUN] Se habrían escrito ${updates.length} updates`);
  }

  // ── 4. Recalcular price_reference para palas afectadas ─────────────────────
  const palaIdsArray = [...palaIdsAfectadas];
  if (palaIdsArray.length > 0 && !DRY_RUN) {
    console.log(`🔁 Recalculando price_reference para ${palaIdsArray.length} palas afectadas...`);
    await recalculatePriceReference(palaIdsArray);
  } else if (DRY_RUN) {
    console.log(`[DRY RUN] Se recalcularían ${palaIdsArray.length} price_references`);
  }

  // ── 5. Resumen ──────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════');
  console.log('📊 RESUMEN DEL REMATCH');
  console.log('════════════════════════════════════════');
  console.log(`Total procesados:    ${stats.total}`);
  console.log(`✅ Nuevos matches:   ${stats.nuevosMatches}  (antes sin match → ahora con match bueno)`);
  console.log(`✅ Mantenidos:       ${stats.mantenidos}   (match ya correcto, confirmado)`);
  console.log(`🔄 Mejorados:        ${stats.mejorados}    (match incorrecto → nuevo match correcto)`);
  console.log(`🚫 Nullificados:     ${stats.nullificados} (match dudoso → sin match, mejor así)`);
  console.log(`⚪ Sin match:        ${stats.sinMatch}     (no matcheaban y siguen sin matchear)`);
  console.log(`❌ Errores:          ${stats.errores}`);
  console.log('════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
