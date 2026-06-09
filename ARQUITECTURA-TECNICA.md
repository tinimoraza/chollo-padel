# HuntPadel — Arquitectura Técnica
*Actualizado: 2026-06-05 — Reset y nueva estrategia de matching*

---

## Visión general

HuntPadel es un agregador de chollos de palas de pádel de segunda mano (Wallapop, Vinted) y tiendas online. Detecta anuncios con descuento real respecto al PVP de tienda, los matchea contra un catálogo canónico de palas, y presenta un ranking TOP + alertas a usuarios.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend/API | Next.js (Vercel Hobby) |
| Base de datos | Supabase (PostgreSQL) |
| Scraper Wallapop | Chrome Extension (MV3, background service worker) |
| Scraper Vinted | GitHub Actions + script Node/TSX |
| Scraper tiendas | GitHub Actions + Playwright/Puppeteer/fetch |
| Catálogo | GitHub Actions diario 07:00 UTC (padelzoom + padelful) |
| CI/CD | GitHub Actions |
| Cron externo | cron-job.org (llama endpoints Vercel directamente) |

---

## Estado actual (2026-06-05)

### ⚠️ Sistema en transición

El sistema de matching anterior (fuzzy + embeddings) fue descartado por generar demasiados falsos positivos y contaminar el catálogo con duplicados y productos incorrectos. Se está construyendo un nuevo sistema basado en **Entity Resolution por atributos estructurados**.

**Qué está activo:**
- Scraper Chrome Extension (Wallapop) — recoge anuncios, sin asignación de pala
- Scraper Vinted (GH Actions) — recoge anuncios, sin asignación de pala
- Scrapers de tiendas (GH Actions) — pausa temporal hasta nuevo pipeline
- Catálogo diario padelzoom + padelful — nuevo, activo desde 2026-06-05

**Qué está pausado:**
- Todos los schedules de GH Actions (comentados con `# [PAUSADO]`)
- Endpoints Vercel de matching/auto-promote/audit (devuelven 503)
- cron-job.org — pausar manualmente en consola

---

## Tablas de Supabase

### Tablas activas

| Tabla | Descripción |
|---|---|
| `productos` | **NUEVO** — Catálogo canónico. Una fila por pala real. Identidad: `marca + linea + modelo + variante + año` |
| `producto_aliases` | **NUEVO** — Todos los nombres que usan las tiendas para el mismo producto. Cada match aprobado genera un alias |
| `wallapop_cache` | Anuncios de segunda mano (Wallapop + Vinted). Sin `pala_id` asignado por ahora |
| `price_sources` | Tiendas registradas como fuentes de precio |
| `alertas` | Alertas de usuarios (query + precio máximo) |
| `notificaciones` | Historial de notificaciones enviadas |

### Tablas vacías / en desuso

| Tabla | Estado |
|---|---|
| `palas` | Vaciada — sustituida por `productos` |
| `palas_candidatas` | Vaciada — lógica de auto-promote eliminada |
| `price_snapshots` | Vaciada — se rellenará con nuevo pipeline de tiendas |
| `price_reference` | Vaciada — se recalculará con nuevo pipeline |
| `price_match_cache` | Vaciada — matcher anterior descartado |
| `top_oportunidades` | Vaciada — se regenerará cuando el matching esté listo |
| `match_audit_log` | Vaciada |
| `search_cache` | Vaciada |

---

## Catálogo canónico — Nueva arquitectura

### Principio fundamental

> La identidad de una pala NO es su nombre. Es la combinación de atributos estructurados: **marca + línea + modelo + variante + año**.

### Schema `productos`

```sql
marca       TEXT    -- 'Bullpadel', 'Nox', 'Adidas'...
linea       TEXT    -- familia: 'Vertex', 'Metalbone', 'AT10'...
modelo      TEXT    -- generación: '04', '3.4', 'HRD', 'Genius 18K'...
variante    TEXT    -- diferenciador: 'Comfort', 'Woman', 'Light', 'CTRL'...
año         INTEGER

-- Técnicos (de Padelful)
forma, balance, tacto, juego, genero
peso_min, peso_max
material_cara, material_nucleo, material_marco

-- Ratings (de Padelful)
rating_global, rating_potencia, rating_control
rating_rebote, rating_manejabilidad, rating_punto_dulce

precio_pvp, imagen_url
UNIQUE(marca, linea, modelo, variante, año)
```

**Sobre `precio_pvp`:**
- Valor inicial = precio mínimo de mercado que publica padelzoom (refleja el mercado actual, no el PVP de salida del fabricante que queda obsoleto)
- Se recalcula con la **media de price_snapshots de tiendas** cuando hay ≥2 matches confirmados sobre esa pala
- El PVP oficial del fabricante (de padelful) NO se usa como referencia — sería absurdo comparar contra el precio de lanzamiento de una pala de 2024

### Schema `producto_aliases`

```sql
producto_id UUID   -- FK → productos.id
texto_original    TEXT  -- "Bullpadel Vertex 05 HYB 2026 Juan Tello"
texto_normalizado TEXT  -- lowercase sin acentos
tienda            TEXT  -- 'padelzoom', 'padelnuestro', 'padelproshop'...
confianza         NUMERIC -- 1.0 = fuente oficial
UNIQUE(tienda, texto_normalizado)
```

### Construcción del catálogo

```
Diario 07:00 UTC — scrape-catalogo.yml
  ↓
1. PADELZOOM (base)
   FacetWP API → lista completa de palas (~800)
   extract-atributos.ts → marca, linea, modelo, variante, año
   precio_pvp = precio mínimo de mercado de padelzoom (referencia inicial)
   → INSERT en productos + alias 'padelzoom'

2. PADELFUL (enriquecimiento)
   API padelful.com/api/v1/rackets (~1400)
   extract-atributos.ts → atributos
   → Buscar por (marca, linea, modelo, variante, año) en productos:
     SI existe → UPDATE ratings + imagen_url + INSERT alias 'padelful'
     SI no existe → INSERT nuevo producto con todos los campos
```

### Extractor de atributos (`scripts/extract-atributos.ts`)

Módulo compartido usado tanto en la construcción del catálogo como en el matching de tiendas.

```
Entrada: "Bullpadel Vertex 04 Comfort 2025"
Salida:
  marca    = "Bullpadel"
  linea    = "Vertex"
  modelo   = "04"
  variante = "COMFORT"
  año      = 2025
```

**Jerarquía de extracción:**
1. Marca → diccionario con aliases normalizados
2. Año → regex `\b(20[2-9]\d)\b`
3. Línea → diccionario por marca (orden especificidad descendente)
4. Variante → diccionario global de variantes conocidas
5. Modelo → lo que queda tras eliminar marca, línea, variante y año

---

## Matching de tiendas — Nueva estrategia (en desarrollo)

### Principio

> No se comparan textos. Se comparan atributos estructurados.

### Flujo

```
Producto de tienda (ej: "Bullpadel Vertex04 25")
  ↓
extract-atributos.ts
  ↓
{ marca: Bullpadel, linea: Vertex, modelo: 04, variante: null, año: 2025 }
  ↓
Scoring contra productos del catálogo:
  marca coincide:   +50
  linea coincide:   +30
  modelo coincide:  +10
  variante coincide: +10
  año coincide:     +10
  ↓
score ≥ umbral  → match automático → price_snapshot + alias
score ambiguo   → cola revisión manual (Gestor)
sin match       → cola revisión manual
  ↓
Cuando ≥2 tiendas tienen price_snapshot para una pala:
  → recalcular precio_pvp = media de esos snapshots
  → actualizar productos.precio_pvp
```

### Aprendizaje continuo

Cada match manual en el Gestor genera:
- Un nuevo alias en `producto_aliases`
- O una nueva regla en el extractor

El sistema mejora con cada revisión.

---

## Segunda mano — Estado y roadmap

### Estado actual
El matching de segunda mano (Wallapop/Vinted) está **pausado**. Los scrapers siguen recogiendo anuncios en `wallapop_cache` pero sin asignar `pala_id`.

### Roadmap
La estrategia de matching para segunda mano será **diferente** a la de tiendas porque los títulos de anuncios de segunda mano son mucho más variables (multilingual, abreviados, sin estructura). Se definirá una vez que el pipeline de tiendas esté funcionando.

---

## GitHub Actions — Estado actual

### Activos con schedule
| Action | Schedule | Qué hace |
|---|---|---|
| **Scrape Catálogo** | Diario 07:00 UTC | Padelzoom + Padelful → tabla `productos` |

### Pausados (schedule comentado, workflow_dispatch disponible)
| Action | Estado |
|---|---|
| Scraper Vinted | ⏸ PAUSADO |
| Match Segunda Mano | ⏸ PAUSADO |
| Top Oportunidades | ⏸ PAUSADO |
| Audit Matches | ⏸ PAUSADO |
| Embedding Rematch | ⏸ PAUSADO |
| Auto Promote Candidatas | ⏸ PAUSADO |
| Review No-Match Diario | ⏸ PAUSADO |
| Check Alerts | ⏸ PAUSADO |
| Scrape Precios Tiendas | ⏸ PAUSADO (solo workflow_dispatch) |

---

## Endpoints Vercel — Estado actual

| Endpoint | Estado |
|---|---|
| `/api/cron/match-wallapop` | ⏸ Devuelve 503 |
| `/api/cron/audit-matches` | ⏸ Devuelve 503 |
| `/api/cron/scrape-wallapop` | ⏸ Devuelve 503 |
| `/api/cron/check-alerts` | ✅ Activo (alertas usuarios) |
| `/api/chollos` | ✅ Activo (sin datos por ahora) |
| `/api/top` | ✅ Activo (sin datos por ahora) |

> **Nota:** Los crons de Vercel se gestionan en cron-job.org además del `vercel.json`. Pausar los schedules de GH Actions no es suficiente — hay que desactivarlos también en cron-job.org.

---

## Chrome Extension (Wallapop)

**Estado:** Activa pero sin matching de pala. Recoge anuncios en `wallapop_cache`.

**Alarms:**
- `scrape`: cada 10 min — recoge anuncios nuevos
- `verify`: cada hora — verifica vendidos
- `category_swipe`: diario — barre categoría completa category_id=12579

**Nota:** El matching de pala_id de la extensión también está desactivado.

---

## Scrapers de tiendas disponibles

| Tienda | Archivo | Método | Estado |
|---|---|---|---|
| Padel Nuestro | padelnuestro.js | Puppeteer | ✅ Funciona |
| PadelZoom | padelzoom.js | FacetWP API | ✅ Funciona (ahora solo catálogo) |
| Tienda PadelPoint | tiendapadelpoint.js | Playwright | ✅ Funciona |
| Street Padel | streetpadel.js | fetch+cheerio | ✅ Funciona |
| Zona de Padel | zonadepadel.js | fetch+cheerio | ✅ Funciona |
| Padel Pro Shop | padelproshop.js | Section API | ✅ Funciona |
| Padel Ibérico | padeliberico.js | fetch+cheerio | ✅ Funciona |
| Tennis-Point | tennispoint.js | Shopify JSON | ✅ Funciona |
| Padel Market | padelmarket.js | — | ✅ Funciona |
| Padel Coronado | padelcoronado.js | Playwright | ✅ Funciona |
| Mister Padel | misterpadel.js | Clerk.io API | ✅ Funciona |
| Roma Sport | romasport.js | Playwright | ⚠️ Intermitente |
| Decathlon | decathlon.js | — | ❌ Bloqueado |
| Padel Vice | padelvice.js | — | ❌ Bloqueado |
| SmashInn | smashinn.js | — | ❌ Bloqueado |
| Time2Padel | time2padel.js | — | ❌ Bloqueado |
| Bullpadel Oficial | bullpadel.js | — | Sin logs |
| Nox Oficial | nox.js | — | Sin logs |
| Siux Oficial | siux.js | — | Sin logs |
| Vibora Oficial | vibora.js | — | Sin logs |
| Ofertas de Padel | ofertasdepadel.js | — | Sin logs |

> **Nota:** Los scrapers de tiendas generarán `price_snapshots` contra la tabla `productos` (no `palas`) en el nuevo pipeline.

---

## Gestor de Palas Candidatas (extensión desktop)

**Archivo:** `C:\chollo-padel-extension\gestor_candidatas.py`

Herramienta de revisión manual para matches ambiguos. Muestra candidatas pendientes con recomendaciones fuzzy. Al aprobar un match:
- Escribe en `price_match_cache` (manual, confidence=1.0)
- Marca la candidata como `matched`

**Bug corregido (2026-06-05):** El pool de búsqueda ya no cae a `self.palas` completo cuando `marca_detectada` es null — evitaba matches cross-brand como NOX → Bullpadel.

---

## Roadmap

1. ✅ Parar todos los procesos de matching antiguo
2. ✅ Limpiar BD (palas, wallapop_cache.pala_id, candidatas, snapshots)
3. ✅ Nuevo schema `productos` + `producto_aliases`
4. ✅ Extractor de atributos (`extract-atributos.ts`)
5. ✅ Script importación catálogo (`import-catalogo.ts`) — padelzoom base, padelful enriquece
6. ✅ GH Action diario 07:00 UTC para catálogo
7. 🔲 Ejecutar import y validar catálogo (~800-1400 productos)
8. 🔲 Nuevo pipeline de tiendas con scoring por atributos
9. 🔲 Activar scrapers de tiendas con nuevo pipeline
10. 🔲 Definir estrategia matching segunda mano (diferente a tiendas)
11. 🔲 Reactivar TOP + Chollos con nuevo sistema
