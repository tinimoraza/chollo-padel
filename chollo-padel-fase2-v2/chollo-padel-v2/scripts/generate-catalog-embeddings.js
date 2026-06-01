/**
 * scripts/generate-catalog-embeddings.js
 *
 * Genera embeddings para todos los modelos del catálogo de palas y los guarda
 * en scripts/data/catalog-embeddings.json.
 *
 * Solo necesita correrse cuando el catálogo cambia (nuevas palas añadidas).
 * Los embeddings se usan después por embedding-matcher.js como alternativa
 * al fuzzy matcher para casos que éste no puede resolver.
 *
 * Modelo: paraphrase-multilingual-MiniLM-L12-v2
 *   - 120MB, se descarga la primera vez y queda en caché ~/.cache/huggingface
 *   - Maneja español, italiano, francés, inglés — perfecto para títulos mixtos de Vinted
 *
 * Uso:
 *   node scripts/generate-catalog-embeddings.js
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const OUTPUT_PATH = path.join(__dirname, 'data', 'catalog-embeddings.json');
const MODEL_NAME  = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

// Misma lógica de normalización que el fuzzy matcher:
// quitar marca, año y nombres de jugadores para quedarnos solo con el modelo
const JUGADORES_RE = /\b(juan lebron|lebron|ale galan|ale galán|martita ortega|alex ruiz|agustín tapia|agustin tapia|arturo coello|paquito navarro|coki nieto|stupa|momo gonzalez|momo gonzález|chingotto|franco chingotto|edu alonso|eduardo alonso|lucia sainz|lucía sainz|maxi sanchez|maxi sánchez|berto trabanco|jose diestro|josé diestro)\b/gi;

function normalizarModelo(nombreCompleto, marca) {
  return nombreCompleto
    .replace(new RegExp(`^${marca}\\s+`, 'i'), '') // quitar marca al inicio
    .replace(/\b20\d{2}\b/g, '')                    // quitar año
    .replace(JUGADORES_RE, '')                       // quitar nombres de jugadores
    .replace(/\b(ltd|ltde|edición|edition|edt)\b/gi, '') // quitar "LTD", "Edition"
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  console.log('🧠 GENERANDO EMBEDDINGS DEL CATÁLOGO');
  console.log(`📅 ${new Date().toISOString()}\n`);

  // ── 1. Cargar catálogo ──────────────────────────────────────────────────────
  console.log('📦 Cargando palas del catálogo...');
  const palas = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('palas')
      .select('id, nombre, marca, año, precio_pvp')
      .range(from, from + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    palas.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`✅ ${palas.length} palas cargadas\n`);

  // ── 2. Cargar modelo de embeddings ─────────────────────────────────────────
  console.log(`🤖 Cargando modelo ${MODEL_NAME}...`);
  console.log('   (primera vez: descarga ~120MB, puede tardar 1-2 min)\n');

  // Import dinámico — @xenova/transformers es ESM
  const { pipeline } = await import('@xenova/transformers');
  const embedder = await pipeline('feature-extraction', MODEL_NAME);
  console.log('✅ Modelo cargado\n');

  // ── 3. Generar embeddings ───────────────────────────────────────────────────
  console.log('⚡ Generando embeddings...');
  const embeddings = {};
  const BATCH = 32;

  for (let i = 0; i < palas.length; i += BATCH) {
    const batch = palas.slice(i, i + BATCH);
    const textos = batch.map(p => normalizarModelo(p.nombre || '', p.marca || ''));

    const output = await embedder(textos, { pooling: 'mean', normalize: true });

    for (let j = 0; j < batch.length; j++) {
      embeddings[batch[j].id] = {
        marca:   batch[j].marca,
        nombre:  batch[j].nombre,
        año:     batch[j].año,
        pvp:     batch[j].precio_pvp,
        texto:   textos[j],
        vector:  Array.from(output[j].data),
      };
    }

    const pct = Math.round(((i + batch.length) / palas.length) * 100);
    process.stdout.write(`\r   ${i + batch.length}/${palas.length} (${pct}%)...`);
  }

  console.log('\n');

  // ── 4. Guardar en disco ────────────────────────────────────────────────────
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(embeddings, null, 0));
  const size = (fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`💾 Guardado en ${OUTPUT_PATH} (${size} MB)`);
  console.log(`✅ ${palas.length} embeddings generados`);
}

main().catch(err => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
