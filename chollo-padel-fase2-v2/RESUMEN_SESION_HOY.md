# HuntPadel — Resumen sesión 26 mayo 2026 (Chat)

## ✅ Lo que se hizo hoy en BD (Supabase directo)

### TOP Oportunidades - limpieza
- Eliminados **1.314 ítems italianos** de `wallapop_cache` (borsa, racchetta, scarpe, cappellino...)
- Eliminada **bolsa Bullpadel Vertex 04** (`borsa da padel`) del TOP
- Eliminada **racchetta** del TOP
- TOP actual limpio: 8 entradas, todas palas reales, descuentos 53-65%

### Chollos - matches incorrectos corregidos
- `catalog/.../adidas-match-light-3-2` → estaba asignada a **Arrow Hit CTRL 2026** (descuento falso 77%) → `pala_id = NULL, disponible = false`
- `pala-head-bolt-2026-rd-bk-226206` → estaba asignada a **Head Coello Motion 2026** (descuento falso 75%) → `pala_id = NULL, disponible = false`
- `adidas-drive-3-2-2023` → estaba asignada a **Adipower 3.2 2023** (incorrecta) → `pala_id = NULL`
- Caché limpiada para las 3 URLs

### Pala añadida al catálogo
- `Bullpadel Neuron 2025` insertada en `palas` (slug: bullpadel-neuron-2025) — necesaria para que fuzzy-matcher v5 matchee correctamente neuron-25

---

## ✅ Código generado (ficheros listos para aplicar)

### fuzzy-matcher.js v5
**Ruta:** `scripts/prices/fuzzy-matcher.js`

**Cambios:**
- `fuzzyMatch(productTitle, productUrl)` — acepta URL como segundo argumento
- `extraerAnioDeUrl(url)` — detecta sufijos `-25-`, `-26-` como año 2025/2026
- `extraerVersionDeUrl(url)` — detecta `-3-3-`, `-3-2-` como versión 3.3, 3.2
- Las señales de URL tienen **prioridad** sobre el título cuando hay conflicto
- Fix: Neuron-25 → año 2025 (no 2024), Drive-3-3 → versión 3.3

### pipeline.js v6
**Ruta:** `scripts/prices/pipeline.js`

**Cambios:**
- `checkUrlDisponible(url)` — HEAD request, detecta 404 y redirects silenciosos de PadelNuestro
- `verificarUrlsNuevas()` — al final de cada scrape, marca `disponible=false` las URLs rotas
- `fuzzyMatch()` recibe ahora `productUrl` como segundo argumento
- `getFromCache()` lee `producto_titulo` — si el título cambió, invalida caché y rematchea
- Evita que matches incorrectos persistan indefinidamente

### test-fixes-v6.js
**Ruta:** `scripts/prices/test-fixes-v6.js`

**Qué comprueba:** 9/9 ✅ confirmado
- Fix 1: URLs rotas PadelNuestro → false (4/4 URLs rotas detectadas)
- Fix 2: Señales URL (Neuron 2025, Drive Blue 2026, Match Light 2026, Arrow Hit 2026)
- Fix 3: Invalidación caché por título cambiado

---

## ⚠️ Pendiente — código aún NO aplicado al repo

### top-oportunidades.ts
**Problema:** el job que recalcula el TOP no filtra:
1. Vocabulario italiano (borsa, racchetta...) — si vuelven a entrar en caché, vuelven al TOP
2. Precios inflados Roma Sport (precio > precio_referencia * 1.5) generan referencias falsas

**Fix necesario:** añadir en la query de Wallapop/Vinted que alimenta el TOP:
```sql
AND title NOT ILIKE '%racchetta%'
AND title NOT ILIKE '%borsa%'
AND title NOT ILIKE '%scarpe%'
AND title NOT ILIKE '%cappellino%'
AND title NOT ILIKE '%zaino%'
```
Y en el cálculo de precio_referencia, excluir snapshots de Roma Sport donde `precio > precio_referencia * 2`.

---

## ⚠️ Pendiente — 6 scrapers nuevos sin verificar

Creados en sesión 5 pero **primer scrape real pendiente de ejecutar y validar**:
- `scripts/prices/scrapers/tennispoint.js`
- `scripts/prices/scrapers/decathlon.js`
- `scripts/prices/scrapers/padelproshop.js`
- `scripts/prices/scrapers/miravia.js`
- `scripts/prices/scrapers/amazon.js`
- `scripts/prices/scrapers/padeliberico.js`

**Para probar:** `node scripts/prices/pipeline.js tennispoint` (uno a uno)

---

## 🔴 Pendiente — Seguridad (urgente)

1. **Rotar service_role key** de Supabase
   - Dashboard → Settings → API → Regenerar `service_role`
   - Actualizar `config.js` de la extensión Chrome con la nueva key

2. **Activar RLS** en 7 tablas (añadir políticas ANTES):
   ```sql
   ALTER TABLE public.searches ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.price_sources ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.price_snapshots ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.price_reference ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.price_match_cache ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.scraper_logs ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.palas_candidatas ENABLE ROW LEVEL SECURITY;
   ```

---

## 📋 Commit pendiente

```bash
git add scripts/prices/fuzzy-matcher.js scripts/prices/pipeline.js scripts/prices/test-fixes-v6.js
git commit -m "fix: pipeline v6 + fuzzy-matcher v5 — URL signals, HTTP check, cache invalidation"
git push
```

Luego en Supabase:
```sql
DELETE FROM price_match_cache;
```

Luego re-scrape:
```bash
node scripts/prices/pipeline.js padelnuestro
```

---

## 🔗 Referencias del proyecto

- **Web:** https://www.huntpadel.com
- **Vercel project:** `prj_wnfDiETPBP4VgmvG7uLQDaRSkeEa`
- **Supabase:** `vgbyhdnhsngaehruirwb`
- **Repo local:** `C:\chollo-padel\chollo-padel-fase2-v2\chollo-padel-v2`
- **Scrapers:** `scripts/prices/scrapers/`
- **Pipeline:** `scripts/prices/pipeline.js`
- **Matcher:** `scripts/prices/fuzzy-matcher.js`

---

## 📁 Ficheros con código listo para aplicar

Los tres ficheros JS están disponibles en los outputs de esta conversación:
- `fuzzy-matcher.js` (v5)
- `pipeline.js` (v6)  
- `test-fixes-v6.js`
- `HUNTPADEL-proyecto.docx` (doc actualizado con sesiones 1-5)

