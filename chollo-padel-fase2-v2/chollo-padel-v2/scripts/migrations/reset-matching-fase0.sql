-- =============================================================================
-- FASE 0 — Reset matching: limpiar BD contaminada por fuzzy/embeddings
-- Fecha: 2026-06-05
-- EJECUTAR EN SUPABASE SQL EDITOR (en orden)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. BORRAR palas auto-promovidas y de fuentes distintas a padelzoom/padelful
--    (estas son las contaminadas por el pipeline de matching anterior)
-- -----------------------------------------------------------------------------

-- Ver cuántas hay antes de borrar (ejecutar primero para verificar):
SELECT fuente, COUNT(*) as total
FROM palas
GROUP BY fuente
ORDER BY total DESC;

-- Borrar todo excepto padelzoom y padelful:
DELETE FROM palas
WHERE fuente NOT IN ('padelzoom', 'padelful')
   OR fuente IS NULL;

-- Verificar qué queda:
SELECT fuente, COUNT(*) as total
FROM palas
GROUP BY fuente;

-- -----------------------------------------------------------------------------
-- 2. LIMPIAR pala_id en wallapop_cache (segunda mano — Wallapop y Vinted)
--    Conservamos los items, solo borramos la asignación de pala
-- -----------------------------------------------------------------------------

UPDATE wallapop_cache
SET
  pala_id      = NULL,
  match_method = NULL,
  año          = NULL
WHERE pala_id IS NOT NULL;

-- Verificar:
SELECT
  COUNT(*) FILTER (WHERE pala_id IS NULL)  AS sin_match,
  COUNT(*) FILTER (WHERE pala_id IS NOT NULL) AS con_match
FROM wallapop_cache;

-- -----------------------------------------------------------------------------
-- 3. LIMPIAR price_match_cache (caché del fuzzy matcher de tiendas)
--    Hay que empezar desde cero con la nueva estrategia
-- -----------------------------------------------------------------------------

DELETE FROM price_match_cache;

-- Verificar:
SELECT COUNT(*) FROM price_match_cache;

-- -----------------------------------------------------------------------------
-- 4. LIMPIAR price_snapshots huérfanos
--    Los snapshots que apuntan a palas que ya no existen
-- -----------------------------------------------------------------------------

DELETE FROM price_snapshots
WHERE pala_id NOT IN (SELECT id FROM palas);

-- Verificar cuántos quedan:
SELECT COUNT(*) FROM price_snapshots;

-- -----------------------------------------------------------------------------
-- 5. LIMPIAR palas_candidatas
--    Eran candidatas del pipeline viejo — empezamos de cero
-- -----------------------------------------------------------------------------

DELETE FROM palas_candidatas;

-- Verificar:
SELECT COUNT(*) FROM palas_candidatas;

-- -----------------------------------------------------------------------------
-- 6. RESUMEN FINAL
-- -----------------------------------------------------------------------------

SELECT
  (SELECT COUNT(*) FROM palas)             AS palas_en_catalogo,
  (SELECT COUNT(*) FROM wallapop_cache)    AS items_segunda_mano,
  (SELECT COUNT(*) FROM price_snapshots)   AS snapshots_precio,
  (SELECT COUNT(*) FROM price_match_cache) AS cache_matcher,
  (SELECT COUNT(*) FROM palas_candidatas)  AS candidatas;
