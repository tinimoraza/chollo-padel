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
  const sorted = [...precios].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return parseFloat(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
  }
  return parseFloat(sorted[mid].toFixed(2));
}

async function run() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Obtener todos los pala_id distintos con snapshots recientes
  const { data: rows, error } = await supabase
    .from('price_snapshots')
    .select('pala_id')
    .eq('disponible', true)
    .gte('scraped_at', since);

  if (error) { console.error(error); process.exit(1); }

  const palaIds = [...new Set(rows.map(r => r.pala_id))];
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

    // Dedup por url_producto
    const byUrl = new Map();
    for (const s of snaps) {
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

    await supabase.from('price_reference').upsert({
      pala_id: palaId,
      precio_referencia,
      precio_minimo,
      precio_maximo,
      fuentes_count,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'pala_id' });

    await supabase.from('palas').update({
      precio_referencia,
      precio_minimo_tiendas: precio_minimo,
      precios_updated_at: new Date().toISOString(),
    }).eq('id', palaId);
  }

  console.log(`\nCompletado: ${actualizadas} actualizadas, ${sin_cambio} sin cambio.`);
}

run().catch(err => { console.error(err); process.exit(1); });
