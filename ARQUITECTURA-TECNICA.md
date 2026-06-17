# HuntPadel — Arquitectura Técnica
*Actualizado: 2026-06-16*

---

## Visión general

HuntPadel es un agregador de chollos de palas de pádel. Detecta anuncios de segunda mano (Wallapop, Vinted) y precios de tiendas online, los matchea contra un catálogo canónico de palas, y presenta un ranking TOP + alertas a usuarios.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend/API | Next.js (Vercel) |
| Base de datos | Supabase (PostgreSQL) |
| Scraper tiendas precios | Scripts Node/TSX locales (3 tiendas activas) |
| Scraper catálogo | padelzoom + padelful (enriquecimiento specs) |
| Scraper segunda mano | Chrome Extension MV3 (Wallapop) |
| Herramienta revisión | GestorCandidatas.exe (Python/CustomTkinter) |

---

## Tablas principales

| Tabla | Descripción |
|---|---|
| `palas` | Catálogo canónico. Una fila por pala real. Identidad: `marca + linea + modelo + variante + año` |
| `producto_aliases` | Nombres que usan las tiendas para el mismo producto. Cada match confirmado genera un alias |
| `palas_candidatas` | Productos scrapeados que no matchearon automáticamente — cola de revisión manual |
| `price_snapshots` | Precios históricos por pala + tienda |
| `price_sources` | Tiendas registradas como fuentes de precio |
| `wallapop_cache` | Anuncios de segunda mano (Wallapop + Vinted) |

---

## Schema `palas`

```sql
marca       TEXT    -- 'Bullpadel', 'Nox', 'Adidas'...
linea       TEXT    -- familia: 'Vertex', 'Metalbone', 'AT10'...
modelo      TEXT    -- generación/versión: '04', '3.4', 'Cup Hard'...
variante    TEXT    -- diferenciador: 'COMFORT', 'LIGHT', 'CTRL', 'CARBON'...
año         INTEGER
nombre      TEXT    -- nombre completo legible
slug        TEXT    -- URL-friendly, único
imagen_url  TEXT
precio_pvp  NUMERIC -- media de price_snapshots disponibles

UNIQUE(marca, linea, modelo, variante, año)
```

**Sobre `precio_pvp`:** Se calcula como media de los `price_snapshots` con `disponible=true` de esa pala. Se recalcula tras cada merge de duplicados.

---

## Extractor de atributos (`scripts/extract-atributos.ts`)

Módulo compartido usado en pipeline de tiendas y deduplicación.

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
1. Pre-proceso: `"+" suelto → "PLUS"` (ej: "Astrum +" → "Astrum PLUS")
2. Marca → diccionario con aliases normalizados
3. Año → regex `\b(20[2-9]\d)\b`, también acepta año corto final (ej: "25" → 2025)
4. Eliminar tokens de jugadores conocidos (Tapia, Lebrón, Coello, etc.)
5. Línea → diccionario por marca (orden especificidad descendente)
6. Variante → lista global: ctrl, control, light, team, carbon, hybrid, lite, air, pro, elite, tour, woman, junior, 18k, 12k, alum...
7. Modelo → lo que queda tras eliminar todo lo anterior

**Casos especiales documentados:**
- `"+"` al final/suelto → `"PLUS"` (StarVie Astrum +, Kenta +, Raptor +)
- `"CTRL"` y `"CONTROL"` son equivalentes (mismo variante normalizado)
- Año corto `"25"` al final del título → `2025`
- Head 2026: líneas renombradas a `"Coello"` (Motion/Pro/Team son variantes)
- Adidas Cross It Team: `linea="Cross It"`, `modelo="Team"` (NO es una línea propia)
- `"Carb-on"` (marca Lok) → preprocesado a `"carbon"` antes de separar por guión
- JOMA `"HRD"` → alias de `"HRD+"` (verificado: la BD solo almacena `HRD+`)
- JUGADORES incluye `'coello', 'ale coello', 'alejandro coello'` (Head Coello Pro/Motion/Junior
  no almacena "coello" como atributo, es puramente nombre de jugador en el título de tienda)
  y `'j sanz'` además de `'jon sanz'`

---

## Pipeline de tiendas (`scripts/pipeline-tiendas.ts`)

### Flujo por producto

```
Producto scrapeado (título + precio + URL)
  ↓
1. Buscar texto normalizado en producto_aliases
   → MATCH → price_snapshot + fin
  ↓
2. extraerAtributos(título)
   → buscarPorAtributos(marca, linea, variante, año, modelo)
     → 1 resultado  → price_snapshot + alias nuevo
     → >1 resultado → palas_candidatas (estado='ambiguo')
     → 0 resultados → palas_candidatas (estado='pendiente')
```

### Función `modeloCompatible`

Decide si el modelo del catálogo es compatible con el modelo extraído de la tienda.

```typescript
// Reglas:
// 1. modelo extraído = null → solo matchea palas con modelo=null en catálogo
//    ("CROSS IT CTRL" sin modelo NO va a "Cross It Team CTRL")
// 2. modelo catálogo = null, extraído != null → no match
// 3. Subset tienda⊆catálogo: "GENIUS 12K" matchea "Genius 12K Alum" (tienda omitió "Alum")
//    EXCEPTO si el catálogo tiene tokens discriminantes extra (ctrl, team, hybrid, air,
//    carbon, light...) → esos indican producto diferente, no mera especificación adicional
//    Ej: "3.4" NO matchea "CTRL 3.4" porque "ctrl" es discriminante
// 4. Subset catálogo⊆tienda: catálogo "Cup Hard" matchea tienda "Cup Hard Pro Series"
```

**MODELO_DISCRIMINANTES** (si aparecen en el catálogo pero no en lo extraído → NO match):
`ctrl, control, team, hybrid, air, carbon, light, plus, elite, power, soft, iron, speed, hard, free`

**MODELO_TOKEN_ALIAS** — normaliza variantes de escritura de un mismo token antes de comparar
(colores en español/inglés y abreviaturas de 2 letras que usan algunas tiendas en el título):
`mtw→multiweight, negra/negro→black, blanca/blanco→white, roja/rojo→red, verde→green,
amarilla/amarillo→yellow, azul→blue, gris→grey, bk→black, bl→blue, rd→red, wh→white, yl→yellow`

### Filtros de exclusión

Antes de intentar matchear, el pipeline descarta productos que no son palas reales independientes:

- **Kits**: título contiene ` kit` (ej. "Pala Wilson Optix Padel Kit")
- **Packs**: título contiene ` pack` (ej. "pack con mochila Pala Siux Electra Pro SE Black 2026")
- **Productos de test**: título contiene `test` como palabra (ej. "Pala de TEST Oxdog Hyper Pro 2.0 2025")
- **Exclusiva padelproshop**: título contiene "exclusiva padelproshop" / "(exclusiva padelproshop)"

En modo `DRY_RUN` cada exclusión se loguea como `🚫 [excluido]` / `🚫 [excluido kit/pack/test]`.

### Regla sin-año

Si el título no trae año y hay varios candidatos que solo difieren en año → se elige el más reciente. Solo se activa si todos los candidatos comparten marca+linea+modelo+variante (diferencia ÚNICA en año).

### Guardia anti-sobrescritura

Si una candidata ya tiene `estado='matched'`, el pipeline NO la vuelve a escribir como pendiente/ambigua. Evita que re-runs deshagan resoluciones manuales.

### Tiendas activas

Cualquier archivo `.js` en `scripts/prices/scrapers/` es una "tienda" lanzable: `pipeline-tiendas.ts`
hace `require(`./prices/scrapers/${tienda}.js`)` dinámicamente, sin lista hardcodeada. Esto significa
que **todas** las tiendas (en producción o no) pasan por el mismo pipeline de matching — no existe
un camino alternativo de fuzzy-matching para las tiendas nuevas. El antiguo `scripts/prices/pipeline.js`
+ `fuzzy-matcher.js` (matching difuso con umbral de similitud) es código legacy que ya no se ejecuta
desde el flujo actual (ni desde el GitHub Action ni desde PipelineLauncher); algunos scrapers conservan
comentarios de cabecera obsoletos que referencian ese pipeline antiguo, pero no afecta al runtime.

**En producción (GitHub Action, `pipeline-tiendas-temp.yml`, 2x/día):**

| Tienda | Archivo | Notas |
|---|---|---|
| padelmarket | padelmarket.js | |
| padelnuestro | padelnuestro.js | Precios reales de mercado |
| padelzoom | padelzoom.js | Catálogo (fuente de specs) |
| allforpadel | allforpadel.js | Requiere Playwright |
| padeliberico | padeliberico.js | Requiere Playwright |
| tennispoint | tennispoint.js | fetch a Shopify JSON API |
| romasport | romasport.js | Requiere Playwright |
| tiendapadel5 | tiendapadel5.js | |
| padelproshop | padelproshop.js | fetch a Shopify Section API |

**Disponibles pero no en producción** (lanzables manualmente vía PipelineLauncher o CLI):
amazon, bullpadel, decathlon, miravia, misterpadel, nox, ofertasdepadel, padelcoronado, padelkiwi,
padelshop, padelspain, padelvice, pdhsports, siux, smashinn, starvie, streetpadel, tiendapadelpoint,
time2padel, vibora, zonadepadel. (decathlon está bloqueada por Cloudflare, ver histórico de sesiones.)

---

## Post-pipeline (`scripts/post-pipeline.ts`)

Script a ejecutar **después de cada pipeline de tiendas**. Hace tres cosas:

1. **Limpiar false negatives**: candidatas `pendiente` cuya marca+linea+modelo ya existe en catálogo pero el pipeline no matcheó (diferencia menor de escritura). Las marca como `matched`.

2. **Auto-promover nuevas**: candidatas `pendiente` con marca+línea reconocida que genuinamente no existen en catálogo → las inserta como pala nueva en `palas`, crea alias, marca como `matched`.

3. **Reportar pendientes**: lo que no se pudo resolver automáticamente (sin marca, sin línea, etc.) → lista para revisión manual.

---

## Proceso operativo completo

**Ciclo estándar (ejecutar en este orden):**

```bash
# 1. Pipeline de cada tienda + post-proceso inmediato
npx tsx --env-file=.env.local scripts/pipeline-tiendas.ts padelzoom
npx tsx --env-file=.env.local scripts/post-pipeline.ts

npx tsx --env-file=.env.local scripts/pipeline-tiendas.ts padelful
npx tsx --env-file=.env.local scripts/post-pipeline.ts

npx tsx --env-file=.env.local scripts/pipeline-tiendas.ts padelnuestro
npx tsx --env-file=.env.local scripts/post-pipeline.ts

# 2. Revisar ambiguos y sin_match en GestorCandidatas.exe
#    - Ambiguos → "Asignar a pala existente"
#    - Sin match reales → "Promover como nueva pala"
#    - Listings viejos/rotos → "Posible nueva" o ignorar

# 3. Deduplicación (cuando se han añadido palas nuevas)
node scripts/fix-duplicados.js          # herramienta visual en http://localhost:4546
# o CLI:
npx tsx --env-file=.env.local scripts/detectar-duplicados.ts --sql

# 4. Falsos positivos (matching tienda↔catálogo cruzado: versión, peso, lite, marca, año)
node scripts/fix-falsos-positivos.js    # herramienta visual en http://localhost:4547
# o solo lectura, sin actuar (corre también semanalmente vía GitHub Action "Falsos Positivos"):
npx tsx --env-file=.env.local scripts/detectar-falsos-positivos.ts
```

**Frecuencia recomendada:** Una vez a la semana o al añadir nuevas palas manualmente.

---

## GestorCandidatas (herramienta desktop)

**Archivo fuente:** `C:\chollo-padel-extension\gestor_candidatas.py`
**Ejecutable:** `C:\chollo-padel-extension\dist\GestorCandidatas.exe`
**Recompilar:** `cd C:\chollo-padel-extension && python -m PyInstaller GestorCandidatas.spec`

Herramienta de revisión manual de candidatas ambiguas o sin match.

**Filtros disponibles:** Pendientes / Ambiguos / Todos / por Marca

**Acciones por candidata:**
- **Asignar a pala existente**: marca como matched y registra price_snapshot
- **Promover como nueva pala**: inserta en `palas` + crea alias
- **Posible nueva**: marca como `posible_nueva` (para revisión posterior)

**Fixes aplicados (2026-06-09):**
- El filtro "Pendientes" ya no oculta candidatas con `auto_promovida=true` + `estado='pendiente'` — el override fue eliminado, ahora `estado` manda siempre
- `↻ Recargar` solo recarga candidatas (no las ~1800+ palas) → recarga rápida

---

## PipelineLauncher (herramienta desktop)

**Archivo fuente:** `C:\chollo-padel-extension\pipeline_launcher.py`
**Ejecutable:** `C:\chollo-padel-extension\dist\PipelineLauncher.exe`
**Recompilar:** `cd C:\chollo-padel-extension && python -m PyInstaller --onefile --windowed --name PipelineLauncher pipeline_launcher.py`

GUI (Python/CustomTkinter, mismo estilo que GestorCandidatas) para lanzar `pipeline-tiendas.ts`
sin usar la terminal.

**Selección de tiendas:** descubre dinámicamente todas las `.js` en `scripts/prices/scrapers/`
(no solo las 9 en producción) y marca con 🟢 las que ya están en el GitHub Action y con ⚪ las que
no. Botón "Solo nuevas" selecciona de golpe solo las que no están en producción. Permite añadir a
mano cualquier nombre de tienda que no aparezca en el listado.

**Modos:** dry-run (no escribe en BD) o real; con/sin post-pipeline al final. Ejecución en serie,
una tienda detrás de otra (con botón para detener tras la tienda en curso).

**Salida:** progreso en vivo + resumen por tienda (alias/atributos/ambiguos/sin_match/total) y un
log JSON en `C:\chollo-padel-extension\logs\pipeline_run_<timestamp>.json` con el detalle completo
de cada ejecución (útil para pasárselo a Claude y verificar resultados).

---

## Deduplicación

### Herramienta visual (`scripts/fix-duplicados.js`)

```bash
node scripts/fix-duplicados.js   # abre http://localhost:4546
```

Detecta grupos de palas duplicadas por tres fases:
1. **Fase 1 — Identidad exacta**: misma `marca+linea+modelo+variante+año`
2. **Fase 2 — Año null**: pala con `año=null` se fusiona con la de año conocido del mismo modelo
3. **Fase 3 — Modelo subconjunto**: "GENIUS 12K" ⊆ "Genius 12K Alum" → mismo producto

Al mergear: redirige price_snapshots y aliases al canonical, recalcula `precio_pvp` como media, borra el duplicado.

### CLI (`scripts/detectar-duplicados.ts`)

```bash
npx tsx --env-file=.env.local scripts/detectar-duplicados.ts         # solo listar
npx tsx --env-file=.env.local scripts/detectar-duplicados.ts --sql   # generar SQL de merge
```

---

## `palas_candidatas` — estados

| Estado | Significado |
|---|---|
| `pendiente` | No matcheó con ninguna pala del catálogo |
| `ambiguo` | Matcheó con más de una pala, requiere elección manual |
| `matched` | Resuelta (manual o automáticamente) |
| `posible_nueva` | No es una pala conocida, posible nuevo producto |

**Nota:** El pipeline solo sobrescribe candidatas que NO están en `matched`. Las demás se actualizan normalmente.

---

## Casos especiales y decisiones de diseño

### Año null como comodín
Una pala con `año=null` en catálogo es compatible con cualquier año extraído de tienda. Evita duplicados cuando una tienda no informa el año.

### Distintas ediciones ≠ duplicados
`Nox AT10 Pro 2024` y `Nox AT10 Pro 2025` son productos distintos, NO duplicados. Solo son duplicados si tienen mismos atributos con residuos de nombre (ej: nombre de jugador que ya se eliminó del extractor).

### Variantes CTRL/CONTROL
Son equivalentes: `normalizarVariante` las mapea ambas a `'ctrl'`.

### Head Coello 2026
A partir de 2026, las líneas `Motion/Pro/Team` de Head pasaron a llamarse `Coello Motion/Pro/Team`. En la BD: `linea='Coello'`, `variante='MOTION'/'PRO'/'TEAM'`.

### Dunlop Aero Star
En la BD: `linea='Aero Star'`, `modelo=null`. Las entradas antiguas con `linea='Aero'` + `modelo='Star'` fueron migradas.

### Adidas Cross It Team CTRL
`linea='Cross It'`, `modelo='Team'`, `variante='CTRL'`. "Cross It Team" NO es una línea propia del extractor.

---

## Scripts disponibles

| Script | Uso |
|---|---|
| `pipeline-tiendas.ts` | Scraping + matching de precios de tiendas |
| `post-pipeline.ts` | Post-proceso: false negatives + auto-promote |
| `detectar-duplicados.ts` | Detección CLI de duplicados en catálogo |
| `fix-duplicados.js` | Herramienta visual de deduplicación (puerto 4546) |
| `promover-candidatas.ts` | Promoción manual de candidatas a palas |
| `refresh-sin-marca.ts` | Refrescar palas sin marca detectada |
| `purge-sold-items.js` | Purgar price_snapshots de productos vendidos |
| `extract-atributos.ts` | Módulo de extracción de atributos (importado por otros) |

---

## Estado actual (2026-06-16)

- ✅ Catálogo: ~1800 palas en `palas`
- ✅ Pipeline de tiendas: funcional con matching por atributos (mismo motor para TODAS las tiendas,
  en producción o no — ya no hay fuzzy-matching al 100% en el flujo activo)
- ✅ 9 tiendas en producción vía GitHub Action (`pipeline-tiendas-temp.yml`, 2x/día); ~21 tiendas
  más con scraper listo pero sin enchufar al Action, lanzables manualmente
- ✅ post-pipeline: auto-resolución de false negatives y nuevas palas
- ✅ GestorCandidatas: funcional, filtros corregidos, recarga rápida
- ✅ PipelineLauncher: GUI para lanzar cualquier tienda (producción o no), serie, con log JSON
- ✅ Filtros de exclusión: kit/pack/test/exclusiva padelproshop
- ✅ Deduplicación: herramienta visual + CLI operativos
- ⏸ Segunda mano (Wallapop/Vinted): scraper activo pero matching pausado
- ⏸ TOP Oportunidades / Chollos: pendiente de activar cuando el matching sea estable
- ⏳ Plan: seguir añadiendo tiendas nuevas a producción de forma agresiva + seguir afinando el matching
