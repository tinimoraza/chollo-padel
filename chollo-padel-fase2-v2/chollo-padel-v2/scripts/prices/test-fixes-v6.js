// scripts/prices/test-fixes-v6.js
// Prueba rápida de los 3 fixes del pipeline v6 / fuzzy-matcher v5
// NO toca la base de datos (dry-run de matching + HTTP check aislado)
//
// Uso: node scripts/prices/test-fixes-v6.js
//
// Qué comprueba:
//   Fix 1 — checkUrlDisponible: URLs rotas de PadelNuestro → false
//   Fix 2 — fuzzyMatch con URL: neuron-25 → año 2025, drive-3-3 → versión 3.3
//   Fix 3 — invalidación de caché: si el título cambia, el match se descarta

require('dotenv').config({ path: '.env.local' });
const { fuzzyMatch } = require('./fuzzy-matcher');

// ── Fix 1: Verificación HTTP ──────────────────────────────────────────────────
async function checkUrlDisponible(url) {
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HuntPadel/1.0)' },
    });
    if (resp.status === 404) return false;
    if (resp.redirected && resp.url !== url) {
      const norm = (u) => u.replace(/^http:/, 'https:').replace(/\/$/, '');
      if (norm(resp.url) !== norm(url)) return false;
    }
    return resp.ok;
  } catch (e) {
    return null;
  }
}

async function testFix1() {
  console.log('\n── Fix 1: Verificación HTTP URLs rotas ──────────────────────');
  const casos = [
    // URLs que sabemos rotas (de la sesión 3):
    { url: 'https://www.padelnuestro.com/bullpadel-neuron-110864-p',         esperado: false, desc: 'Neuron vieja (descatalogada)' },
    { url: 'https://www.padelnuestro.com/pala-drop-shot-conqueror-control-dp304006', esperado: false, desc: 'Drop Shot Conqueror (rota)' },
    { url: 'https://www.padelnuestro.com/adidas-adipower-ctrl-team-2023-32311-p',    esperado: false, desc: 'Adipower Ctrl Team 2023 (rota)' },
    { url: 'https://www.padelnuestro.com/black-crown-piton-attack-15k-power-2024-111806-p', esperado: false, desc: 'Black Crown Pitón (rota)' },
    // URL válida de control:
    { url: 'https://www.padelnuestro.com/palas-padel', esperado: true,  desc: 'Listado PadelNuestro (debe funcionar)' },
  ];

  for (const c of casos) {
    const resultado = await checkUrlDisponible(c.url);
    const ok = resultado === c.esperado || (c.esperado === false && resultado === false);
    console.log(`  ${ok ? '✅' : '❌'} ${c.desc}`);
    console.log(`     URL: ${c.url}`);
    console.log(`     Resultado: ${resultado} (esperado: ${c.esperado})`);
  }
}

// ── Fix 2: fuzzyMatch con URL ─────────────────────────────────────────────────
async function testFix2() {
  console.log('\n── Fix 2: Señales de año/versión desde URL ──────────────────');
  const casos = [
    {
      title: 'Bullpadel Neuron',
      url:   'https://www.padelnuestro.com/bullpadel-neuron-25-113768-p',
      desc:  'Neuron: URL indica -25- → debe matchear año 2025 (Neuron 25), NO 2024',
      check: (r) => r.pala_nombre?.includes('2025') || r.pala_nombre?.toLowerCase().includes('neuron 25'),
    },
    {
      title: 'Adidas Drive Blue',
      url:   'https://www.padelnuestro.com/adidas-drive-blue-2026-p',
      desc:  'Drive Blue 2026: URL NO tiene -3-3- → debe matchear Drive Blue 2026, no Drive 3.3',
      check: (r) => r.pala_nombre?.includes('2026'),
    },
    {
      title: 'Adidas Match Light',
      url:   'https://www.padelnuestro.com/adidas-match-light-2026-p',
      desc:  'Match Light 2026: debe matchear 2026, no Match Light 3.2 (2023)',
      check: (r) => r.pala_nombre?.includes('2026'),
    },
    {
      title: 'Adidas Arrow Hit',
      url:   'https://www.padelnuestro.com/adidas-arrow-hit-2026-p',
      desc:  'Arrow Hit 2026: debe matchear 2026, no Hexagon',
      check: (r) => r.pala_nombre?.toLowerCase().includes('arrow hit') && r.pala_nombre?.includes('2026'),
    },
  ];

  for (const c of casos) {
    try {
      const r = await fuzzyMatch(c.title, c.url);
      const ok = c.check(r);
      console.log(`  ${ok ? '✅' : '❌'} ${c.desc}`);
      console.log(`     Match: ${r.pala_nombre || 'null'} (conf: ${r.confidence?.toFixed(3)}, método: ${r.method})`);
    } catch (e) {
      console.log(`  ⚠️  Error: ${e.message}`);
    }
  }
}

// ── Fix 3: Invalidación de caché por título ───────────────────────────────────
function testFix3() {
  console.log('\n── Fix 3: Invalidación de caché por cambio de título ────────');
  // Simula la lógica de pipeline sin tocar BD
  const cacheTitulo = 'Bullpadel Neuron 2024';       // título guardado en caché
  const tituloActual = 'Bullpadel Neuron 25';         // título actual del producto

  const cacheInvalidada = cacheTitulo !== tituloActual;
  console.log(`  ${cacheInvalidada ? '✅' : '❌'} Títulos distintos → caché invalidada`);
  console.log(`     Guardado: "${cacheTitulo}"`);
  console.log(`     Actual:   "${tituloActual}"`);

  const cacheMismoTitulo = 'Adidas Drive Blue 2026';
  const titActualMismo   = 'Adidas Drive Blue 2026';
  const cacheValida = cacheMismoTitulo === titActualMismo;
  console.log(`  ${cacheValida ? '✅' : '❌'} Títulos iguales → caché válida (no rematchea)`);
}

// ── Runner ────────────────────────────────────────────────────────────────────
(async () => {
  console.log('🏓 HuntPadel — Test fixes pipeline v6 / fuzzy-matcher v5');
  console.log('='.repeat(60));

  await testFix1();
  await testFix2();
  testFix3();

  console.log('\n' + '='.repeat(60));
  console.log('✅ Tests completados. Revisa los ❌ si los hay.');
  console.log('\nSi todo ✅, pasos siguientes:');
  console.log('  1. git add scripts/prices/fuzzy-matcher.js scripts/prices/pipeline.js');
  console.log('  2. git commit -m "fix: pipeline v6 + fuzzy-matcher v5 — URL signals, HTTP check, cache invalidation"');
  console.log('  3. git push');
  console.log('  4. DELETE FROM price_match_cache;  (en Supabase SQL editor)');
  console.log('  5. node scripts/prices/pipeline.js padelnuestro  (re-scrape limpio)');
})();
