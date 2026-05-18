// scripts/prices/claude-matcher.js
// Usa Claude API para resolver anuncios de wallapop_cache sin pala_id.
// Para cada anuncio sin match, calcula los top candidatos fuzzy y
// pregunta a Claude cuál es el match correcto (o ninguno).
//
// Uso: node scripts/prices/claude-matcher.js
// Opciones:
//   --dry-run        No escribe en BD, solo muestra resultados
//   --limit 50       Procesa solo N anuncios (útil para probar)
//   --batch 10       Anuncios por llamada a Claude (default: 10)

require('dotenv').config({ path: '.env.local' });
const https   = require('https');
const { createClient } = require('@supabase/supabase-js');
const { JaroWinklerDistance } = require('natural');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const DRY_RUN   = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.indexOf('--limit');
const LIMIT     = LIMIT_ARG !== -1 ? parseInt(process.argv[LIMIT_ARG + 1]) : 500;
const BATCH_ARG = process.argv.indexOf('--batch');
const BATCH     = BATCH_ARG !== -1 ? parseInt(process.argv[BATCH_ARG + 1]) : 10;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY no encontrada en .env.local');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/pala\s+(de\s+)?p[aá]del\s*/gi, '')
    .replace(/raqueta\s+(de\s+)?p[aá]del\s*/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function motivoDescarte(titulo) {
  const t = titulo.toLowerCase();
  if (/\bpaletero\b|\bbolsa\b|\bmochila\b|\bzapatilla\b|\bgrip\b|\bovergrip\b|\bprotector\b/.test(t)) return 'accesorio';
  if (/\b\d+\s*(palas|raquetas)\b/.test(t)) return 'pack multiple';
  if (/\bwilson\b.*(blade|ultra|clash|pro\s*staff)/i.test(t)) return 'tenis Wilson';
  if (/\bbabolat\b.*(pure\s*(drive|aero|strike)|boost)/i.test(t)) return 'tenis Babolat';
  if (/\btenis\b|\btennis\b/.test(t) && !/padel/.test(t)) return 'tenis';
  return null;
}

function getTopCandidates(titulo, palas, n = 8) {
  const norm = normalize(titulo);
  // Detectar marca
  const marcas = [...new Set(palas.map(p => (p.marca || '').toLowerCase()))];
  const marcaDetectada = marcas.find(m => norm.includes(normalize(m)));
  const candidatos = marcaDetectada
    ? palas.filter(p => (p.marca || '').toLowerCase().includes(marcaDetectada))
    : palas;

  return candidatos
    .map(p => ({
      id: p.id,
      nombre: p.nombre,
      año: p.año,
      score: JaroWinklerDistance(norm, normalize(p.nombre))
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

// ── Claude API ────────────────────────────────────────────────────────────────

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (json.error) return reject(new Error(json.error.message));
          resolve(json.content[0].text);
        } catch (e) {
          reject(new Error('Claude parse error: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('Claude timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Prompt para un batch de anuncios ─────────────────────────────────────────

function buildPrompt(batch) {
  const items = batch.map((item, i) => {
    const candidatesStr = item.candidates
      .map((c, j) => `    ${j + 1}. [${c.id}] ${c.nombre} (${c.año || '?'}) — score: ${c.score.toFixed(2)}`)
      .join('\n');
    return `ANUNCIO ${i + 1}:
  Título: "${item.title}"
  Precio: ${item.price}€
  Candidatos:
${candidatesStr}`;
  }).join('\n\n');

  return `Eres un experto en palas de pádel. Para cada anuncio de Wallapop/Vinted, determina cuál de los candidatos es la pala correcta, o si ninguno encaja.

REGLAS:
- Solo confirma match si estás seguro al >90%. En caso de duda, pon "no_match".
- El año es MUY importante: una NOX AT10 2024 NO es la misma pala que una NOX AT10 2025.
- El modelo exacto importa: "Genius 12K" ≠ "Genius 18K" ≠ "Genius Attack" ≠ "Pro Cup".
- Si el título no menciona año, acepta el candidato con mejor score solo si el nombre coincide bien.
- Descarta zapatillas, paleteros, grips aunque aparezcan como candidatos.
- Los números de versión importan: Vertex 03 ≠ Vertex 05, Hack 03 ≠ Hack 04.

${items}

Responde SOLO con JSON válido, sin explicaciones, sin markdown:
[
  {"anuncio": 1, "match": "ID_DE_PALA_O_no_match", "confianza": 0.95, "razon": "breve"},
  {"anuncio": 2, "match": "no_match", "confianza": 0, "razon": "breve"},
  ...
]`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🤖 Claude Matcher${DRY_RUN ? ' [DRY RUN]' : ''} — batch=${BATCH}, limit=${LIMIT}`);
  console.log('─'.repeat(60));

  // 1. Cargar palas
  console.log('📦 Cargando palas...');
  const { data: palas, error: errPalas } = await supabase
    .from('palas')
    .select('id, nombre, marca, modelo, año');
  if (errPalas) throw new Error(errPalas.message);
  console.log(`   ${palas.length} palas cargadas`);

  // 2. Cargar anuncios sin pala_id
  console.log('🔍 Cargando anuncios sin matchear...');
  const { data: anuncios, error: errAnuncios } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, price')
    .is('pala_id', null)
    .not('match_method', 'eq', 'descartado')
    .not('match_method', 'eq', 'sin_año')
    .not('match_method', 'eq', 'año_incorrecto')
    .not('title', 'is', null)
    .order('scraped_at', { ascending: false })
    .limit(LIMIT);

  if (errAnuncios) throw new Error(errAnuncios.message);
  console.log(`   ${anuncios.length} anuncios por procesar`);

  // 3. Pre-filtrar y calcular candidatos
  const porProcesar = [];
  let descartados = 0;

  for (const anuncio of anuncios) {
    const motivo = motivoDescarte(anuncio.title);
    if (motivo) { descartados++; continue; }

    const candidates = getTopCandidates(anuncio.title, palas);
    // Solo procesar si hay al menos un candidato con score >= 0.50
    if (candidates.length === 0 || candidates[0].score < 0.50) continue;

    porProcesar.push({ ...anuncio, candidates });
  }

  console.log(`   ${descartados} descartados (accesorios/tenis)`);
  console.log(`   ${porProcesar.length} enviando a Claude\n`);

  // 4. Procesar en batches
  const stats = { matches: 0, no_match: 0, errores: 0 };
  const updates = [];

  for (let i = 0; i < porProcesar.length; i += BATCH) {
    const batch = porProcesar.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH) + 1;
    const totalBatches = Math.ceil(porProcesar.length / BATCH);

    process.stdout.write(`  🤖 Batch ${batchNum}/${totalBatches} (${batch.length} anuncios)... `);

    try {
      const prompt = buildPrompt(batch);
      const respuesta = await callClaude(prompt);

      // Parsear JSON — limpiar posibles backticks
      const clean = respuesta.replace(/```json|```/g, '').trim();
      const resultados = JSON.parse(clean);

      for (const r of resultados) {
        const anuncio = batch[r.anuncio - 1];
        if (!anuncio) continue;

        if (r.match && r.match !== 'no_match' && r.confianza >= 0.80) {
          stats.matches++;
          updates.push({
            external_id:      anuncio.external_id,
            pala_id:          r.match,
            match_confidence: r.confianza,
            match_method:     'claude',
          });
          if (DRY_RUN) {
            const pala = palas.find(p => p.id === r.match);
            console.log(`\n    ✅ "${anuncio.title.slice(0, 45)}" → ${pala?.nombre || r.match} (${(r.confianza * 100).toFixed(0)}%)`);
          }
        } else {
          stats.no_match++;
          if (DRY_RUN) {
            console.log(`\n    ❌ "${anuncio.title.slice(0, 45)}" → no_match (${r.razon})`);
          }
        }
      }

      if (!DRY_RUN) process.stdout.write(`✅ ${resultados.length} procesados\n`);
      else process.stdout.write('\n');

    } catch (err) {
      console.error(`\n  ⚠️  Error en batch ${batchNum}: ${err.message}`);
      stats.errores++;
    }

    // Delay entre batches para no saturar la API
    if (i + BATCH < porProcesar.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // 5. Escribir en BD
  if (!DRY_RUN && updates.length > 0) {
    console.log(`\n💾 Guardando ${updates.length} matches en BD...`);
    const WRITE_BATCH = 50;
    let guardados = 0;

    for (let i = 0; i < updates.length; i += WRITE_BATCH) {
      const batch = updates.slice(i, i + WRITE_BATCH);
      const promises = batch.map(u =>
        supabase
          .from('wallapop_cache')
          .update({
            pala_id:          u.pala_id,
            match_confidence: u.match_confidence,
            match_method:     u.match_method,
          })
          .eq('external_id', u.external_id)
      );
      await Promise.all(promises);
      guardados += batch.length;
      process.stdout.write(`  ✅ ${guardados}/${updates.length}\r`);
    }
    console.log('');
  }

  // 6. Resumen
  console.log('\n📊 RESUMEN');
  console.log('─'.repeat(60));
  console.log(`  Procesados:     ${porProcesar.length}`);
  console.log(`  ✅ Matches:     ${stats.matches}`);
  console.log(`  ❌ No match:    ${stats.no_match}`);
  console.log(`  ⚠️  Errores:    ${stats.errores}`);
  if (DRY_RUN) console.log('\n  ℹ️  Dry run — no se escribió nada en BD');
  console.log('');
}

main().catch(err => {
  console.error('💥 Error fatal:', err.message);
  process.exit(1);
});
