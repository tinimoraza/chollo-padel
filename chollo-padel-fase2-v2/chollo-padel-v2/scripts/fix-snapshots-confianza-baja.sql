-- fix-snapshots-confianza-baja.sql
-- Elimina price_snapshots con match_confidence < 0.92 que pueden haber
-- contaminado precio_referencia con palas incorrectas.
-- EJECUTAR en Supabase SQL Editor.
--
-- Paso 1: ver cuántos snapshots afectados hay (sin borrar)
SELECT
  COUNT(*) AS total_afectados,
  COUNT(DISTINCT pala_id) AS palas_afectadas,
  MIN(match_confidence) AS conf_minima,
  MAX(match_confidence) AS conf_maxima,
  AVG(match_confidence)::numeric(4,3) AS conf_media
FROM price_snapshots
WHERE match_confidence < 0.92
  AND match_confidence IS NOT NULL;

-- Paso 2 (opcional): ver ejemplos de los snapshots problemáticos
SELECT
  ps.pala_id,
  p.modelo,
  p.marca,
  ps.precio,
  ps.match_confidence,
  ps.url_producto,
  ps.scraped_at
FROM price_snapshots ps
JOIN palas p ON p.id = ps.pala_id
WHERE ps.match_confidence < 0.92
  AND ps.match_confidence IS NOT NULL
ORDER BY ps.match_confidence ASC
LIMIT 50;

-- Paso 3: BORRAR snapshots de baja confianza
-- DESCOMENTAR solo cuando hayas revisado el paso 1 y 2:
/*
DELETE FROM price_snapshots
WHERE match_confidence < 0.92
  AND match_confidence IS NOT NULL;
*/

-- Paso 4: recalcular precio_referencia para las palas afectadas.
-- Hacerlo vía pipeline tras el borrado:
--   node scripts/prices/pipeline.js padelnuestro
--   node scripts/prices/pipeline.js padelzoom
--   node scripts/prices/pipeline.js romasport
--   node scripts/prices/pipeline.js padelcoronado
-- O bien directamente con la función recalculatePriceReference().

-- ================================================================
-- LIMPIAR CACHÉ DE MATCHES CON CONFIDENCE BAJA
-- ================================================================
-- La tabla price_match_cache guarda los matches previos. Si tiene
-- entradas con confidence < 0.92, el pipeline las reutilizará sin
-- pasar por fuzzy-matcher aunque hayas subido el threshold.
-- Hay que borrarlas para que se recalculen en el siguiente scrape.

-- Paso 5: ver cuántas entradas de caché están afectadas
SELECT
  COUNT(*) AS entradas_cache_afectadas,
  COUNT(DISTINCT source_id) AS fuentes
FROM price_match_cache
WHERE confidence < 0.92
  AND confidence IS NOT NULL
  AND pala_id IS NOT NULL;  -- solo las que tenían match asignado (las null ya son no-match)

-- Paso 6: BORRAR entradas de caché con match de baja confianza
-- DESCOMENTAR para ejecutar:
/*
DELETE FROM price_match_cache
WHERE confidence < 0.92
  AND confidence IS NOT NULL
  AND pala_id IS NOT NULL;
*/
-- Tras esto, el siguiente pipeline recalcula todos esos matches
-- con el nuevo threshold 0.92, y los incorrectos caerán a candidatas.
