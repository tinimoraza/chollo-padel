# HuntPadel — Arquitectura Técnica
*Actualizado: 2026-08-03*

---

## Visión general

HuntPadel es un agregador de chollos de palas de pádel. Detecta anuncios de segunda mano (Wallapop, Vinted) y precios de tiendas online, los matchea contra un catálogo canónico de palas, y presenta un ranking TOP + alertas a usuarios vía web y Telegram.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend/API | Next.js (Vercel) — huntpadel.com |
| Base de datos | Supabase (PostgreSQL) — proyecto `vgbyhdnhsngaehruirwb` |
| Pipeline de tiendas (principal) | GitHub Actions (`pipeline-tiendas-temp.yml`, 2x/día) |
| Pipeline de tiendas (redundancia) | Task Scheduler Windows 08:00 (`scripts-local/run-pipeline-local.ps1`) |
| Scraper tiendas WooCommerce+CF | Extensión Chrome Chollo Padel Scraper v3.0 (`chollo-padel-tiendas-extension/`) |
| Scraper segunda mano | GitHub Action (`dispatch-scraper-vinted.yml`) + scraper Vinted/Wallapop |
| Herramientas de revisión | GestorCandidatas.exe, GestorClub.exe, PipelineLauncher.exe (Python/CustomTkinter) |

---

## Tablas principales

| Tabla | Descripción |
|---|---|
| `palas` | Catálogo canónico. Una fila por pala real. Identidad: `marca + linea + modelo + variante + año` |
| `product_aliases` | Nombres que usan las tiendas para el mismo producto |
| `price_sources` | Tiendas registradas como fuentes de precio |
| `price_snapshots` | Precio actual por pala + tienda (disponible, sku, codigo_descuento, descuento_pct) |
| `price_history_log` | Histórico de precios insert-only (una fila por cambio de precio) |
| `wallapop_cache` | Anuncios de segunda mano (Wallapop + Vinted) |
| `candidatas` | Candidatas de segunda mano procesadas (matched/pendiente/descartada) |
| `clubes_equipos` | Equipos de pádel (para /clubes) |
| `clubes_jugadores` | Jugadores por equipo, con estadísticas |
| `log_fusiones` | Historial de fusiones de palas duplicadas |

---

## Schema `palas`

```sql
marca             TEXT    -- 'Bullpadel', 'Nox', 'Adidas'...
linea             TEXT    -- familia: 'Vertex', 'Metalbone', 'AT10'...
modelo            TEXT    -- generación/versión: '04', '3.4', 'Cup Hard'...
variante          TEXT    -- diferenciador: 'COMFORT', 'LIGHT', 'CTRL', 'CARBON'...
año               INTEGER
nombre            TEXT    -- nombre completo legible
slug              TEXT    -- URL-friendly, único
imagen_url        TEXT
precio_pvp        NUMERIC -- precio lista (referencia externa, sin calcular)
precio_referencia NUMERIC -- mediana de price_snapshots disponibles (calculado por post-pipeline)
precio_minimo_tiendas NUMERIC -- mínimo actual entre tiendas activas
precios_updated_at TIMESTAMPTZ -- última vez que se recalcularon precios

UNIQUE(marca, linea, modelo, variante, año)
```

**Sobre `precio_referencia`:** Se calcula como **mediana** (no media) de los `price_snapshots` con `disponible=true`. Mediana elegida para ser resistente a precios inflados puntuales. Se recalcula en `post-pipeline.ts` tras cada scraping.

---

## Extractor de atributos (`scripts/extract-atributos.ts`)

Módulo compartido. Entrada: título de producto. Salida: `{ marca, linea, modelo, variante, año, jugadorMencionado }`.

**Jerarquía de extracción:**
1. Pre-proceso: `"+" suelto → "PLUS"`, strips de marketing, normalización acentos
2. Marca → diccionario con aliases normalizados
3. Año → regex `\b(20[2-9]\d)\b`, también acepta año corto final (ej: "25" → 2025)
4. Jugadores conocidos → se eliminan del título (campo `jugadorMencionado` separado para fallback)
5. Línea → diccionario por marca (orden especificidad descendente)
6. Variante → lista global: ctrl, light, team, carbon, hybrid, lite, air, pro, elite, tour, woman, junior, 18k, 12k, alum...
7. Modelo → lo que queda tras eliminar todo lo anterior

**Casos especiales documentados:**
- `"+"` al final/suelto → `"PLUS"` (StarVie Astrum +, Kenta +, Raptor +)
- `"CTRL"` y `"CONTROL"` son equivalentes (normalizados a `ctrl`)
- Año corto `"25"` al final del título → `2025`
- Head 2026: líneas renombradas a `"Coello"` (Motion/Pro/Team son variantes)
- Adidas Cross It Team: `linea="Cross It"`, `modelo="Team"` (NO es una línea propia)
- `"Carb-on"` (marca Lok) → preprocesado a `"carbon"` antes de separar por guión
- JOMA `"HRD"` → alias de `"HRD+"` en BD
- `jugadorMencionado` permite fallback en matching si el match por atributos falla

---

## Pipeline de tiendas (`scripts/pipeline-tiendas.ts`)

### Flujo por producto

```
Producto scrapeado (título + precio + URL + sku + imagen)
  ↓
1. Buscar texto normalizado en product_aliases
   → MATCH → price_snapshot + fin
  ↓
2. extraerAtributos(título)
   → buscarPorAtributos(marca, linea, variante, año, modelo)
     → 1 resultado  → price_snapshot + alias nuevo
     → >1 resultado → candidata (estado='ambiguo')
     → 0 resultados → candidata (estado='pendiente')
     [fallback: retry con jugadorMencionado si hay]
```

### Filtros de exclusión

Antes de intentar matchear, el pipeline descarta:
- Títulos con ` kit`, ` pack`, `test` como palabra
- Títulos con "exclusiva padelproshop"
- Marcas en `MARCAS_NO_CATALOGADAS` (Power Padel, Sanyo, Bonabola, etc.)

### Regla sin-año

Si el título no trae año y hay varios candidatos que solo difieren en año → se elige el más reciente.

### Guardia anti-sobrescritura

Si una candidata ya tiene `estado='matched'`, el pipeline NO la vuelve a escribir como pendiente/ambigua.

### `modeloCompatible`

Decide si el modelo del catálogo es compatible con el extraído de la tienda:
- modelo extraído = null → solo matchea palas con modelo=null
- Subset tienda⊆catálogo permitido, SALVO si catálogo tiene tokens discriminantes extra (`ctrl, team, hybrid, air, carbon, light, plus, elite, power, soft, iron, speed, hard, free`)
- Subset catálogo⊆tienda también permitido

### Tiendas activas

Cualquier `.js` en `scripts/prices/scrapers/` es lanzable dinámicamente. Las activas en GitHub Actions están en `pipeline-tiendas-temp.yml`.

---

## Post-pipeline (`scripts/post-pipeline.ts`)

Se ejecuta después de cada ciclo de scraping. Recalcula `precio_referencia` (mediana) para todas las palas con snapshots nuevos/modificados.

---

## Match segunda mano (`scripts/match-segunda-mano.ts`)

Matchea `wallapop_cache` (Wallapop + Vinted) contra el catálogo usando el mismo extractor de atributos. Resultado en tabla `candidatas`.

---

## Top oportunidades (`scripts/top-oportunidades.ts`)

Calcula un ranking de las mejores oportunidades de segunda mano. Score por candidata:

```
score = descuento_pct
      + ahorro_euros * PESO_AHORRO_EUROS
      + calcularBonusAño(nombreParaAño)   ← usa nombre de pala asignada si hay pala_id en BD
      + BONUS_LIKES (8 * log1p(favorites))
      - PEN_ANTIGÜEDAD (penalización por días sin modificar)
```

- `CONDICIONES_TOP = ['new', 'un_opened', 'as_good_as_new']` — si el live check a Wallapop detecta que el vendedor cambió la condición fuera de este rango, el anuncio se descarta automáticamente y se actualiza `wallapop_cache.condition`.
- Si hay `pala_id` asignado en BD, se usa el nombre de la pala asignada para calcular el bonus de año (corrige cuando el vendedor pone año incorrecto en el título).

---

## Notificaciones Telegram (`scripts/notify-chollos-telegram.ts`)

Consume `/api/chollos` como fuente de verdad. Genera tarjeta visual (imagen) con Sharp y la envía por Telegram. Solo notifica chollos que no se han notificado antes (control por BD).

---

## Pipeline local — Task Scheduler Windows

**Script maestro:** `C:\chollo-padel\scripts-local\run-pipeline-local.ps1`
**Horario:** 08:00 diario

Lanza 4 grupos de scrapers en paralelo, espera hasta 90 min, y luego ejecuta post-pipeline + match segunda mano + notificación Telegram. Al arrancar mata automáticamente procesos zombie de runs anteriores.

Todos los scripts usan `npx --yes tsx` para evitar bloqueos por confirmación interactiva de nuevas versiones de tsx.

### Grupos
| Grupo | Tiendas |
|---|---|
| A | padelnuestro, time2padel, padelproshop, padelspain, padeltienda, tennispoint, padelvice, stockpadel, starvie |
| B | padelzoom, ofertasdepadel, zonadepadel, padelmarket, padelkiwi, padelstyle, misterpadel, outletdepadel, pelotapadel |
| C | streetpadel, m1padel, justpadel, futurapadelshop, virtualpadel, padelmania, keepadel |
| PW (Playwright) | allforpadel, padeliberico, romasport, tiendapadel5, padelcoronado, tiendapadelpoint, originalpadel |

---

## Extensión Chrome — Chollo Padel Scraper v3.0

**Código:** `chollo-padel-tiendas-extension/`

Scrapea tiendas WooCommerce con Cloudflare Turnstile abriendo tabs reales de Chrome. Corre cada 2h en background. Tiendas: padelcoronado (woocommerce-tab + backoff 24h), padelstyle, padeltienda.

---

## Web pública — huntpadel.com

Next.js en `chollo-padel-fase2-v2/chollo-padel-v2/app/`. Desplegada en Vercel.

| Ruta | Contenido |
|---|---|
| `/chollos` | Palas con ≥15% descuento sobre precio_referencia. Muestra código de descuento si lo hay. |
| `/top` | Top oportunidades segunda mano por score |
| `/palas` | Catálogo completo con precios por tienda, gráfico histórico de precios, filtro chollos |
| `/palas/[slug]` | Ficha de pala individual |
| `/buscar` | Búsqueda libre |
| `/marcas/[marca]` | SEO por marca |
| `/clubes` | Área privada (magic link) — gestión de equipos ODS |

---

## Herramientas desktop (Python/CustomTkinter)

**Repo:** `C:\chollo-padel-extension\`
**Compilar:** `python -m PyInstaller NombreScript.spec` (specs ya creados)

| Herramienta | Fuente | Función |
|---|---|---|
| GestorCandidatas.exe | `gestor_candidatas.py` | Revisar candidatas segunda mano, catálogo, falsos positivos, imágenes, fusiones |
| GestorClub.exe | `gestor_club.py` | Gestionar equipo ODS: jugadores, jornadas, estadísticas |
| PipelineLauncher.exe | `pipeline_launcher.py` | GUI para lanzar pipeline de tiendas desde Windows |

---

## Estado actual (2026-08-03)

- ✅ Catálogo: ~2400+ palas en `palas`
- ✅ Pipeline de tiendas: GitHub Actions (2x/día) + Task Scheduler local (08:00)
- ✅ ~30+ tiendas con scraper, la mayoría activas en producción
- ✅ Extensión Chrome: padelcoronado + padelstyle + padeltienda
- ✅ Segunda mano: Wallapop + Vinted scrapeados, matching funcional
- ✅ Top oportunidades: score con bonus año, condición live check, penalización antigüedad
- ✅ Notificaciones Telegram: chollos de tiendas con tarjeta visual
- ✅ Web pública: huntpadel.com — chollos, top, palas, SEO por marca
- ✅ Detección de códigos de descuento y secciones de rebajas en scrapers
- ✅ Histórico de precios en `price_history_log`
- ✅ Área privada /clubes para gestión de equipos (magic link)
- ✅ GestorCandidatas, GestorClub, PipelineLauncher operativos
