# HuntPadel — Resumen sesión 1 junio 2026

## 🎯 Objetivo del día
Mejorar calidad de datos (precio_reference, matching), cobertura de scrapers, SEO inicial y sistema de matching semántico con embeddings.

---

## ✅ SEO

### Google Search Console verificado
- Meta tag `google-site-verification` ya estaba live en el site
- Propiedad `https://huntpadel.com/` verificada con cuenta p.alonso.fdez@gmail.com
- Sitemap `https://huntpadel.com/sitemap.xml` enviado (5 URLs: home, buscar, top, chollos, palas)
- 5 páginas con indexación solicitada manualmente desde Inspector de URLs

### JSON-LD structured data añadido
- `app/top/layout.tsx` → schema WebPage + BreadcrumbList
- `app/chollos/layout.tsx` → schema WebPage + BreadcrumbList
- `app/palas/layout.tsx` → schema CollectionPage + BreadcrumbList
- `app/buscar/layout.tsx` → schema SearchResultsPage + BreadcrumbList
- Homepage ya tenía WebSite + Organization + SearchAction

---

## ✅ Limpieza de price_reference (BD)

### Problema detectado
449 entradas en `price_reference` donde `precio_referencia` era >1.4× o <0.5× del `precio_pvp` oficial del catálogo — causando falsos chollos y falsos top.

**Casos graves encontrados:**
- "Adidas Match 3.1 2022": precio_ref 334.99€ vs pvp real 60€ (ratio 5.58×)
- "SIUX GEA": precio_ref 269.95€ vs pvp 119.95€ (ratio 2.25×)
- "Adidas Metalbone 09" matcheado a "Metalbone 2026 Ale Galán" (modelo incorrecto)

### Fix aplicado en BD
```sql
UPDATE price_reference pr
SET precio_referencia = p.precio_pvp
FROM palas p
WHERE pr.pala_id = p.id
  AND p.precio_pvp > 0
  AND (pr.precio_referencia > p.precio_pvp * 1.4 OR pr.precio_referencia < p.precio_pvp * 0.5)
```
→ 449 referencias corregidas directamente en BD

### Fix permanente en pipeline (v8)
**Archivo:** `scripts/prices/pipeline.js`
- Umbral de confianza subido: `0.92 → 0.95` en `runPipeline`
- Sanity check de pvp añadido en `recalculatePriceReference`: si mediana calculada es >1.4× o <0.5× del `precio_pvp`, usar `precio_pvp` como fallback y loguear

---

## ✅ Fuzzy Matcher — mejoras

### Archivo: `scripts/prices/fuzzy-matcher.js`
1. **Números de generación 01-09 como diferenciadores** — "Metalbone 09" ya no matchea a "Metalbone 2026 Ale Galán"
2. **Umbral ambigüedad 0.88 → 0.92** — matches sin año pero modelo correcto ahora se guardan en BD (aparecen en buscador aunque no en top/chollos)
3. **Marcas nuevas añadidas a MARCAS_CONOCIDAS**: Alkemia, Munich, Puma, Enebe, Kombat, Lok, Slazenger, Hirostar, Cartri, Cork, Sane, Endless, Pallap, Tactical Padel, Racket Project, RS Padel, NZN

### Archivo: `scripts/match-pala-id.ts` (cron Vercel)
- Mismo fix de ambigüedad: en lugar de retornar `'ambiguous'` (pala_id=null) cuando solo hay ambigüedad de año, ahora asigna el modelo más reciente con `match_method='fuzzy_year_ambiguous'`
- Marcas nuevas añadidas a MARCAS_CONOCIDAS
- Nuevo contador en log: `yearAmbiguous` (buscador) separado de `ambiguous` (genuinamente irresoluble)

---

## ✅ Rematch masivo de wallapop_cache

### Resultados del rematch completo
```
Total procesados:    18.913
✅ Nuevos matches:   264
✅ Mantenidos:       2.470  (confirmados correctos)
🔄 Mejorados:        640    (corregidos a modelo correcto)
🚫 Nullificados:     3.786  (matches dudosos eliminados)
⚪ Sin match:        11.753
🧠 Por embedding:    477    (rescatados por el modelo semántico)
❌ Errores:          0
```

### Limpieza de basura Vinted en BD
- ~4.200 entradas de ropa italiana eliminadas (felpa, tuta, maglietta, etc.)

---

## ✅ Sistema de embeddings

### Modelo: `paraphrase-multilingual-MiniLM-L12-v2`
- Soporta español, italiano, francés, inglés
- 120MB, corre en Node.js CPU sin API externa (coste 0)
- Embeddings del catálogo: 1.736 palas → 13.6MB JSON

### Archivos creados
- `scripts/generate-catalog-embeddings.js` — genera `scripts/data/catalog-embeddings.json`
- `scripts/prices/embedding-matcher.js` — matcher semántico (cosine similarity, threshold 0.82)
- `scripts/rematch-wallapop-cache.js` — rematch con fuzzy + embedding fallback
- `scripts/embedding-rematch-daily.js` — script ligero para GH Actions
- `.github/workflows/embedding-rematch.yml` — workflow diario 3am UTC

### Arquitectura final
- **Cada hora (Vercel cron)**: fuzzy matcher rápido para items nuevos
- **Cada día (GH Actions 3am)**: regenera embeddings del catálogo + embedding rematch para no_match/ambiguous
- **Manual**: `node scripts/rematch-wallapop-cache.js` para rematch masivo

---

## ✅ Cobertura de scrapers

### Extension Chrome (config.js)
Actualizada con todas las marcas solicitadas y sus familias:
- **Nuevas marcas añadidas**: Kombat (fuji, galeras, krakatoa, etna, osorno, teide, vesubio, arenal, swat, obus), Enebe (mustang, spitfire, response, suburban, aerox, rsx, combat, nitro, space), Cork, Sane, RS Padel, Cartri, NZN, Vision, Endless, Tactical Padel, Pallap, Hirostar, Racket Project, Slazenger, Munich
- **Familias ampliadas**: Siux (fenix, trilogy, valkiria, gea, spyder, astra, beat), Vibora (black mamba, king cobra, diva, naya), StarVie (triton, drax, kenta, aquila, brava, black titan, exodus), Drop Shot (axion, conqueror, canyon, explorer, furia, flame, cyber, blitz), Black Crown (piton, patron, gladius, rebel, shark, epic, special)

### Vinted scraper (`scripts/scrape-vinted.ts`)
- Añadidos keywords para familias ampliadas (Siux, Vibora, Drop Shot, Black Crown)
- Kombat (fuji, galeras, krakatoa, etna), Enebe, Lok, Hirostar, Racket Project, Slazenger, Cork, Sane, RS Padel, Cartri, Endless, Tactical Padel, Pallap
- **Filtro positivo añadido**: solo guarda items que contengan señal de pádel en el título (elimina ropa, zapatillas, etc. que Vinted mezcla porque ignora catalog[]=4597)

### Wallapop scraper (`scripts/scrape-wallapop.ts`)
- Añadidos: `pala kuikma`, `kombat fuji`, `kombat galeras`, `kombat krakatoa`, `pala kombat padel`

---

## ⚠️ Pendiente / Para revisar en próximas sesiones

### Marcas sin catálogo (esperar datos)
Cork, Sane, RS Padel, Cartri, NZN, Vision, Endless, Tactical Padel, Pallap, Hirostar, Racket Project, Slazenger, Munich no tienen palas en tabla `palas`. Revisar en ~1 semana si han acumulado volumen en wallapop_cache tras los nuevos keywords.

### Embeddings y catálogo
- `catalog-embeddings.json` se regenera cada día via GH Actions — siempre fresco
- Si se añaden palas nuevas al catálogo y se quiere matchear inmediatamente: `node scripts/generate-catalog-embeddings.js` + `node scripts/rematch-wallapop-cache.js`

### Problemas de matching no resueltos
- "Adidas Cross It 3.4 2025" no matchea porque el vendedor omite "CTRL" — embedding debería rescatarlo
- 3.900 palas reales aún sin match (título muy genérico, modelos no en catálogo, o año ambiguo)

### Vinted catalog[] filter
El parámetro `catalog[]=4597` no funciona con search_text en la API de Vinted (ignorado por diseño del servidor). La solución adoptada es el filtro positivo de palabras en el título.

---

## 🔗 Referencias del proyecto

- **Web:** https://www.huntpadel.com
- **Vercel project:** `prj_wnfDiETPBP4VgmvG7uLQDaRSkeEa`
- **Supabase:** `vgbyhdnhsngaehruirwb`
- **Repo local:** `C:\chollo-padel\chollo-padel-fase2-v2\chollo-padel-v2`
- **Repo raíz (git):** `C:\chollo-padel`
- **Extensión Chrome:** `C:\chollo-padel-extension` (no requiere commit, recargar en chrome://extensions)
- **Embeddings catálogo:** `scripts/data/catalog-embeddings.json` (13.6MB)
- **Node en Windows:** `& "C:\Program Files\nodejs\node.exe"`
