-- fix-snapshots-junior-wc.sql
-- Limpia snapshots incorrectos y recalcula precio_referencia de las palas afectadas.
-- Ejecutar MANUALMENTE en Supabase SQL Editor.
-- Paso 1: ver qué se va a borrar (ejecutar primero solo esto)

SELECT
  ps.id,
  src.nombre AS tienda,
  ps.url_producto,
  p.modelo AS modelo_asignado,
  ps.precio,
  ps.match_confidence,
  ps.scraped_at
FROM price_snapshots ps
JOIN price_sources src ON src.id = ps.source_id
JOIN palas p ON p.id = ps.pala_id
WHERE (
  ps.url_producto ILIKE '%junior%'
  OR ps.url_producto ILIKE '%-jr-%'
  OR ps.url_producto ILIKE '%-jr-%'
  OR ps.url_producto ILIKE '%youth%'
  OR ps.url_producto ILIKE '%bambino%'
  OR ps.url_producto ILIKE '%kids%'
  OR ps.url_producto ILIKE '%world-cup%'
  OR ps.url_producto ILIKE '%wc-2026%'
  OR ps.url_producto ILIKE '%-wc-%'
  OR ps.url_producto ILIKE '%argentina%'
  OR ps.url_producto ILIKE '%alemania%'
  OR ps.url_producto ILIKE '%espa-a%'
  OR ps.url_producto ILIKE '%-usa-%'
  OR ps.url_producto ILIKE '%england%'
  OR ps.url_producto ILIKE '%colombia%'
  OR ps.url_producto ILIKE '%multination%'
  OR ps.url_producto ILIKE '%belgiu%'
  OR ps.url_producto ILIKE '%netherland%'
)
ORDER BY tienda, ps.url_producto;

-- ─────────────────────────────────────────────────────────────────────────────
-- Paso 2: guardar los pala_ids afectados para recalcular referencia después
-- (ejecutar esto en tu app o tomar nota de los IDs del paso 1)

-- ─────────────────────────────────────────────────────────────────────────────
-- Paso 3: borrar los snapshots incorrectos

DELETE FROM price_snapshots
WHERE id IN (
  SELECT ps.id
  FROM price_snapshots ps
  WHERE (
    ps.url_producto ILIKE '%junior%'
    OR ps.url_producto ILIKE '%-jr-%'
    OR ps.url_producto ILIKE '%youth%'
    OR ps.url_producto ILIKE '%bambino%'
    OR ps.url_producto ILIKE '%kids%'
    OR ps.url_producto ILIKE '%world-cup%'
    OR ps.url_producto ILIKE '%wc-2026%'
    OR ps.url_producto ILIKE '%-wc-%'
    OR ps.url_producto ILIKE '%argentina%'
    OR ps.url_producto ILIKE '%alemania%'
    OR ps.url_producto ILIKE '%espa-a%'
    OR ps.url_producto ILIKE '%-usa-%'
    OR ps.url_producto ILIKE '%england%'
    OR ps.url_producto ILIKE '%colombia%'
    OR ps.url_producto ILIKE '%multination%'
    OR ps.url_producto ILIKE '%belgiu%'
    OR ps.url_producto ILIKE '%netherland%'
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Paso 4: limpiar la caché de matching para que se re-matcheen (o descarten)
DELETE FROM price_match_cache
WHERE producto_url ILIKE '%junior%'
   OR producto_url ILIKE '%-jr-%'
   OR producto_url ILIKE '%youth%'
   OR producto_url ILIKE '%bambino%'
   OR producto_url ILIKE '%kids%'
   OR producto_url ILIKE '%world-cup%'
   OR producto_url ILIKE '%wc-2026%'
   OR producto_url ILIKE '%-wc-%'
   OR producto_url ILIKE '%argentina%'
   OR producto_url ILIKE '%alemania%'
   OR producto_url ILIKE '%espa-a%'
   OR producto_url ILIKE '%-usa-%'
   OR producto_url ILIKE '%england%'
   OR producto_url ILIKE '%colombia%'
   OR producto_url ILIKE '%multination%'
   OR producto_url ILIKE '%belgiu%'
   OR producto_url ILIKE '%netherland%';

-- ─────────────────────────────────────────────────────────────────────────────
-- Paso 5: después de ejecutar los DELETEs, forzar recálculo de precio_referencia
-- lanzando el pipeline manualmente desde GitHub Actions (workflow_dispatch en scrape-precios.yml)
-- o ejecutando: node scripts/prices/pipeline.js padelnuestro (etc.)
