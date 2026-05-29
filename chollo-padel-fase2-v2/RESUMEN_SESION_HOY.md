# HuntPadel — Resumen sesión 29 mayo 2026

## ✅ Scrapers arreglados y verificados

### padelproshop.js (v10 — FINAL)
**Ruta:** `scripts/prices/scrapers/padelproshop.js`

**Problema:** Shopify JSON API (`/products.json`) devolvía 403. La paginación por `link[rel="next"]` fallaba porque el sitio usa infinite scroll AJAX.

**Solución:** Shopify Section API:
```
https://padelproshop.com/collections/palas-padel?page=N&section_id=template--26596133339441__main
```
- Devuelve HTML parcial con 20 productos/página, hasta 25 páginas
- Parser: split por `<product-card`, extrae `data-hover-title` y `href`
- Precios via regex `[\d]+[,.]?\d*\s*€`
- Resultado: **492 palas ✅**

### tennispoint.js (v2)
**Ruta:** `scripts/prices/scrapers/tennispoint.js`

**Problema:** Tennis-Point migró a Shopify. URL antigua `/padel/palas-de-padel/` da 404.

**Solución:** Shopify products.json API (esta tienda sí lo permite):
```
https://www.tennis-point.es/collections/padel/products.json?limit=250&page=N
```
- Filtra por `product_type === 'Padel rackets'`
- Excluye productos de test: `price < 30` y `/\btest\b/i.test(p.title)`
- Resultado: **241 palas ✅**

### decathlon.js — ELIMINADO del workflow
**Motivo:** Cloudflare bloquea todo (fetch, Playwright, etc.). No viable sin servicio de pago.
**Acción:** Eliminado paso "Scrape Decathlon ES" de `.github/workflows/scrape-precios.yml`.

---

## ✅ Fixes de producto

### Top Oportunidades — zapatillas filtradas
**Archivo:** `scripts/top-oportunidades.ts`

**Fixes aplicados:**
1. Vinted category corregida: `catalog[]=4482` → `catalog[]=4597` (categoría correcta de palas, no incluye zapatillas)
2. Palabras excluidas ampliadas: añadidos `'hybrid fly', 'flow hybrid', 'flow speed', 'flow control', 'flow fast'`
3. Filtro regex para tallas de calzado:
   ```typescript
   const TALLA_CALZADO_RE = /(?<![0-9])(3[5-9]|4[0-8])[,.]5?(?![0-9])/
   if (TALLA_CALZADO_RE.test(item.title)) continue
   ```

### CHOLLOS — Siux Fenix Pro 5 duplicada
**Archivo:** `app/api/chollos/route.ts`

**Problema:** El mismo modelo aparecía dos veces (una por tienda) porque dedup era por `pala_id + source_id`.

**Fix:** Dedup cambiado a solo `pala_id`, queda la tienda con el precio más bajo:
```typescript
// Antes: const key = `${snap.pala_id}__${snap.source_id}`
// Después:
const key = snap.pala_id
```

---

## ✅ GitHub Actions actualizado
**Archivo:** `C:\chollo-padel\.github\workflows\scrape-precios.yml`

Cambios en Grupo C:
- Eliminado paso `Scrape Decathlon ES`
- Nombre actualizado: `"Scrape C: padelproshop + tennispoint + miravia + amazon"`
- Comentario cabecera actualizado

> Nota: padelproshop y tennispoint ya no necesitan Playwright (usan fetch), pero se mantienen en Grupo C junto a miravia y amazon que sí lo necesitan. La instalación de Playwright en Grupo C sigue siendo necesaria para miravia/amazon.

---

## ⚠️ Pendiente de sesiones anteriores (sigue vigente)

### fuzzy-matcher.js v5 + pipeline.js v6
Código generado en sesión 26 mayo pero **aún no commitado**.
```bash
git add scripts/prices/fuzzy-matcher.js scripts/prices/pipeline.js scripts/prices/test-fixes-v6.js
git commit -m "fix: pipeline v6 + fuzzy-matcher v5 — URL signals, HTTP check, cache invalidation"
git push
```
Luego limpiar caché en Supabase: `DELETE FROM price_match_cache;`

### top-oportunidades.ts — filtros italiano
Vocabulario italiano (borsa, racchetta...) puede volver si re-entran en caché. Fix pendiente de aplicar en la query.

### Seguridad (urgente)
1. Rotar service_role key de Supabase y actualizar extensión Chrome
2. Activar RLS en 7 tablas

---

## 📋 Commits pendientes de esta sesión

```bash
# Desde C:\chollo-padel\chollo-padel-fase2-v2\chollo-padel-v2
git add scripts/prices/scrapers/padelproshop.js
git add scripts/prices/scrapers/tennispoint.js
git add scripts/top-oportunidades.ts
git add scripts/scrape-vinted.ts
git add app/api/chollos/route.ts

# Desde C:\chollo-padel\chollo-padel-fase2-v2 (o raíz del repo)
git add .github/workflows/scrape-precios.yml

git commit -m "fix: scrapers padelproshop (Section API) + tennispoint (Shopify JSON), rm decathlon workflow, chollos dedup fix, top-oportunidades zapas filter"
git push
```

---

## 🔗 Referencias del proyecto

- **Web:** https://www.huntpadel.com
- **Vercel project:** `prj_wnfDiETPBP4VgmvG7uLQDaRSkeEa`
- **Supabase:** `vgbyhdnhsngaehruirwb`
- **Repo local:** `C:\chollo-padel\chollo-padel-fase2-v2\chollo-padel-v2`
- **Workflow:** `C:\chollo-padel\.github\workflows\scrape-precios.yml`
- **Scrapers:** `scripts/prices/scrapers/`
- **Node en Windows:** `& "C:\Program Files\nodejs\node.exe"`

---

## 🗂️ Estado scrapers

| Scraper       | Estado   | Técnica              | Resultado       |
|---------------|----------|----------------------|-----------------|
| padelnuestro  | ✅ OK    | Puppeteer            | —               |
| padelzoom     | ✅ OK    | Puppeteer            | —               |
| romasport     | ✅ OK    | Playwright           | —               |
| padelcoronado | ✅ OK    | Playwright           | —               |
| padeliberico  | ✅ OK    | Playwright           | —               |
| padelproshop  | ✅ OK    | fetch (Section API)  | 492 palas       |
| tennispoint   | ✅ OK    | fetch (Shopify JSON) | 241 palas       |
| decathlon     | ❌ BAJA  | Cloudflare bloqueado | Eliminado       |
| miravia       | ⚠️ ?    | Playwright           | No verificado   |
| amazon        | ⚠️ ?    | P