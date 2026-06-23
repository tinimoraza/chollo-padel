// scripts/prices/recalculate-all-references.js
// Recalcula precio_referencia para TODAS las palas con snapshots en los últimos 30 días.
// Versión optimizada: bulk queries en lugar de 1 query por pala.

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const FUENTES_EXCLUIR = new Set([2, 9]); // padelzoom, romasport
const IN_BATCH   = 200;  // max IDs por .in() query
const UPS_BATCH  = 500;  // filas por upsert bulk
const PAR_BATCH  = 50;   // palas actualizadas en paralelo

function mediana(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Fix 2026-06-23: la media aritmetica simple es sensible a outliers - un solo
// precio suelto (PVP sin descuento en una tienda, o un precio desactualizado)
// inflaba/deflactaba precio_referencia y generaba "chollos" falsos. Verificado
// con datos reales: usar la mediana en su lugar NO es mejor de forma fiable
// (empate casi exacto frente a la media en cobertura de tiendas: 166 vs 146
// de 783 productos). La solucion validada es una MEDIA RECORTADA: se detectan
// los precios anomalos de cada producto con MAD (desviacion absoluta mediana,
// metodo estadistico estandar para outliers) y se promedian solo los precios
// "normales" - el mismo metodo de siempre (sumar y dividir), pero sin dejar
// que un precio suelto lo distorsione. Si no hay outliers (la mayoria de
// productos), el resultado es identico a la media de siempre.
function calcularReferencia(precios) {
  if (!precios.length) return null;
  if (precios.length < 3) {
    return parseFloat((precios.reduce((a, b) => a + b, 0) / precios.length).toFixed(2));
  }
  const med = mediana(precios);
  const desviaciones = precios.map(p => Math.abs(p - med));
  const mad = mediana(desviaciones);
  const normales = mad > 0
    ? precios.filter(p => Math.abs(p - med) <= 3.0 * mad)
    : precios;
  const usados = normales.length > 0 ? normales : precios;
  return parseFloat((usados.reduce((a, b) => a + b, 0) / usados.length).toFixed(2));
}

async function fetchAll(table, select, filters = []) {
  const rows = [];
  let offset = 0;
  while (true) {
    let q = supabase.from(table).select(select).range(offset, offset + 999);
    for (const [method, ...args] of filters) q = q[method](...args);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return rows;
}

async function fetchIn(table, select, field, ids, extraFilters = []) {
  const rows = [];
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const batch = ids.slice(i, i + IN_BATCH);
    let q = supabase.from(table).select(select).in(field, batch);
    for (const [method, ...args] of extraFilters) q = q[method](...args);
    const { data, error } = await q;
    if (error) throw error;
    if (data) rows.push(...data);
  }
  return rows;
}

async function run() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const now   = new Date().toISOString();

  console.log('Cargando pala_ids con snapshots recientes...');
  const snapIds = await fetchAll('price_snapshots', 'pala_id', [
    ['eq', 'disponible', true],
    ['gte', 'scraped_at', since],
  ]);
  const palaIds = [...new Set(snapIds.map(r => r.pala_id))];
  console.log(`${palaIds.length} palas con snapshots en los últimos 30 días.`);

  console.log('Cargando snapshots en bulk...');
  const allSnaps = await fetchIn(
    'price_snapshots', 'pala_id,precio,source_id,url_producto',
    'pala_id', palaIds,
    [['eq', 'disponible', true], ['gte', 'scraped_at', since]]
  );
  console.log(`  ${allSnaps.length} snapshots cargados.`);

  console.log('Cargando datos de palas en bulk...');
  const allPalas = await fetchIn('palas', 'id,modelo,precio_referencia', 'id', palaIds);
  const palaMap = new Map(allPalas.map(p => [p.id, p]));

  const snapsByPala = new Map();
  for (const s of allSnaps) {
    if (!snapsByPala.has(s.pala_id)) snapsByPala.set(s.pala_id, []);
    snapsByPala.get(s.pala_id).push(s);
  }

  const priceRefRows = [];
  const palaUpdateRows = [];
  let actualizadas = 0, sin_cambio = 0;

  for (const palaId of palaIds) {
    const snaps = snapsByPala.get(palaId) || [];
    if (!snaps.length) continue;

    const snapsParaRef = snaps.filter(s => !FUENTES_EXCLUIR.has(s.source_id));
    const snapsFuente  = snapsParaRef.length > 0 ? snapsParaRef : snaps;

    const byUrl = new Map();
    for (const s of snapsFuente) {
      if (!byUrl.has(s.url_producto) || s.precio < byUrl.get(s.url_producto).precio)
        byUrl.set(s.url_producto, s);
    }
    const unique  = [...byUrl.values()];
    const precios = unique.map(s => Number(s.precio));

    const precio_referencia = calcularReferencia(precios);
    const precio_minimo     = Math.min(...precios);
    const precio_maximo     = Math.max(...precios);
    const fuentes_count     = new Set(unique.map(s => s.source_id)).size;

    const anterior = palaMap.get(palaId);
    if (anterior?.precio_referencia !== precio_referencia) {
      const diff = anterior?.precio_referencia != null
        ? (precio_referencia - anterior.precio_referencia).toFixed(2)
        : 'N/A';
      console.log(`  ${anterior?.modelo || palaId}: ${anterior?.precio_referencia}EUR -> ${precio_referencia}EUR (${diff > 0 ? '+' : ''}${diff}EUR)`);
      actualizadas++;
    } else {
      sin_cambio++;
    }

    priceRefRows.push({ pala_id: palaId, precio_referencia, precio_minimo, precio_maximo, fuentes_count, updated_at: now });
    palaUpdateRows.push({ id: palaId, precio_referencia, precio_minimo_tiendas: precio_minimo, precios_updated_at: now });
  }

  console.log(`\nUpsert bulk price_reference (${priceRefRows.length} filas)...`);
  for (let i = 0; i < priceRefRows.length; i += UPS_BATCH) {
    const { error } = await supabase
      .from('price_reference')
      .upsert(priceRefRows.slice(i, i + UPS_BATCH), { onConflict: 'pala_id' });
    if (error) console.error('  ERROR upsert price_reference:', error.message);
  }

  console.log(`Actualizando palas (${palaUpdateRows.length} filas, ${PAR_BATCH} en paralelo)...`);
  for (let i = 0; i < palaUpdateRows.length; i += PAR_BATCH) {
    const batch = palaUpdateRows.slice(i, i + PAR_BATCH);
    await Promise.all(batch.map(p =>
      supabase.from('palas').update({
        precio_referencia:       p.precio_referencia,
        precio_minimo_tiendas:   p.precio_minimo_tiendas,
        precios_updated_at:      p.precios_updated_at,
      }).eq('id', p.id)
    ));
  }

  console.log(`\nCompletado: ${actualizadas} actualizadas, ${sin_cambio} sin cambio.`);
}

run().catch(err => { console.error(err); process.exit(1); });
