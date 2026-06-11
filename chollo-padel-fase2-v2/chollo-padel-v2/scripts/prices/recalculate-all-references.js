// scripts/prices/recalculate-all-references.js
// Uso: node scripts/prices/recalculate-all-references.js
//
// Recalcula precio_referencia con MEDIANA para TODAS las palas que tienen
// snapshots en los últimos 30 días. Ejecutar una vez tras el fix de mediana
// para corregir los valores inflados por Roma Sport (media → mediana).
//
// Seguro de ejecutar varias veces (upsert idempotente).

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

function calcularMediana(precios) {
  if (precios.length === 0) return null;
  const suma = precios.reduce((a, b) => a + b, 0);
  return parseFloat((suma / precios.length).toFixed(2));
}

async function run() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Obtener todos los pala_id distintos con snapshots recientes
  // Paginamos de 1000 en 1000 para esquivar el max-rows server-side de Supabase
  const allPalaIds = new Set();
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data: rows, error } = await supabase
      .from('price_snapshots')
      .select('pala_id')
      .eq('disponible', true)
      .gte('scraped_at', since)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!rows || rows.length === 0) break;
    rows.forEach(r => allPalaIds.add(r.pala_id));
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  const palaIds = [...allPalaIds];
  console.log(`Recalculando ${palaIds.length} palas con snapshots en los últimos 30 días...`);

  let actualizadas = 0;
  let sin_cambio = 0;

  for (const palaId of palaIds) {
    const { data: snaps } = await supabase
      .from('price_snapshots')
      .select('precio, source_id, url_producto')
      .eq('pala_id', palaId)
      .eq('disponible', true)
      .gte('scraped_at', since);

    if (!snaps || snaps.length === 0) continue;

    // Excluir fuentes que distorsionan la referencia (igual que pipeline.js):
    //   2 = PadelZoom: agregador que ya muestra precios bajados → infla bajada artificial
    //   9 = Roma Sport: publica precios de catalogo inflados → distorsiona la mediana
    // Si tras excluirlas no quedan fuentes, usar todas como fallback.
    const FUENTES_EXCLUIR = new Set([2, 9]);
    const snapsParaRef = snaps.filter(s => !FUENTES_EXCLUIR.has(s.source_id));
    const snapsFuente  = snapsParaRef.length > 0 ? snapsParaRef : snaps;

    // Dedup por url_producto
    const byUrl = new Map();
    for (const s of snapsFuente) {
      if (!byUrl.has(s.url_producto) || s.precio < byUrl.get(s.url_producto).precio) {
        byUrl.set(s.url_producto, s);
      }
    }
    const unique = [...byUrl.values()];
    const precios = unique.map(s => s.precio);

    const precio_referencia = calcularMediana(precios);
    const precio_minimo = Math.min(...precios);
    const precio_maximo = Math.max(...precios);
    const fuentes_count = new Set(unique.map(s => s.source_id)).size;

    // Obtener referencia anterior para mostrar diff
    const { data: anterior } = await supabase
      .from('palas')
      .select('modelo, precio_referencia')
      .eq('id', palaId)
      .single();

    const diff = anterior?.precio_referencia
      ? (precio_referencia - anterior.precio_referencia).toFixed(2)
      : 'N/A';

    if (anterior?.precio_referencia !== precio_referencia) {
      console.log(`  ${anterior?.modelo || palaId}: ${anterior?.precio_referencia}€ → ${precio_referencia}€ (${diff > 0 ? '+' : ''}${diff}€)`);
      actualizadas++;
    } else {
      sin_cambio++;
    }

    const { data: existing } = await supabase
      .from('price_reference')
      .select('pala_id')
      .eq('pala_id', palaId)
      .maybeSingle();

    const payload = {
      precio_referencia,
      precio_minimo,
      precio_maximo