# HuntPadel — Resumen sesión 2 junio 2026

## 🎯 Objetivo del día
Corrección de bugs en chollos (IVA tiendapadelpoint, colisiones de matching), limpieza de segunda mano (vendidos Vinted/Wallapop), rediseño de scrapers segunda mano hacia cobertura total por categoría, y análisis de cobertura de tiendas.

---

## ✅ Fixes chollos y matching

### fix(chollos): colisión Lapi Edition + umbral precio mínimo adaptativo
**Archivo:** `app/api/chollos/route.ts`
- Añadida colisión `['lapi-edition', 'tournament pro iconic']` a URL_MODEL_COLISIONES
- Umbral mínimo de precio adaptativo según fuentes_count:
  - fuentes_count >= 3 → umbral 0.75 (historial fiable)
  - fuentes_count == 2 → umbral 0.65 (palas nuevas que debutan en oferta, como Joma Blast/Hyper 2026)

### fix(tiendapadelpoint): IVA adaptativo
**Archivo:** `scripts/prices/scrapers/tiendapadelpoint.js`
- tiendapadelpoint es inconsistente: muestra precio con IVA para algunos productos y sin IVA para otros (bug OpenCart)
- **Heurística implementada**: si `precio × 1.21` da un número de retail (decimal .90–.99 o .00–.05 o .50), se asume sin IVA y se aplica ×1.21. Si no, ya incluye IVA.
- Ejemplos validados:
  - Enebe Space: listing 79.95€ → 79.95 × 1.21 = 96.74 (cents=74, no retail) → usa 79.95 ✓
  - Vairo Grapheno: listing 118.97€ → 118.97 × 1.21 = 143.95 (cents=95, retail) → usa 143.95 ✓

### fix(scrape): resiliencia GH Actions Grupo B
**Archivo:** `.github/workflows/scrape-precios.yml`
- Añadido `continue-on-error: true` a todos los steps del Grupo B (romasport, padelcoronado, padeliberico, tiendapadelpoint, streetpadel, zonadepadel)
- Timeout de Playwright en tiendapadelpoint: 30s → 60s
- Antes: un timeout de tiendapadelpoint mataba toda la cadena y Roma Sport / padeliberico no se ejecutaban

---

## ✅ Sistema de limpieza segunda mano

### fix(vinted): detección mejorada de items vendidos/eliminados
**Archivo:** `scripts/scrape-vinted.ts`
- `isVintedItemActive()` ahora detecta tres estados de no-disponible:
  - `can_be_sold === false` (vendido)
  - `is_visible === false` (eliminado por el vendedor) ← nuevo
  - `status !== 0` (estado numérico distinto de activo) ← nuevo
- Cap de la cola stale subido: 200 → 500 items por run

### script: purge-sold-items.js
**Archivo:** `scripts/purge-sold-items.js`
- Barrido masivo de items vendidos con concurrencia 20
- Uso: `node scripts/purge-sold-items.js` (ambas plataformas) o `vinted`/`wallapop`
- Resultado del primer barrido completo (15.459 items): 189 eliminados en 98 segundos
- Paginación Supabase correcta (lotes de 1.000 para superar límite default)

---

## ✅ Rediseño scrapers segunda mano — cobertura total

### Vinted: categoría completa (v4)
**Archivo:** `scripts/scrape-vinted.ts`
- **Antes**: bucle de 50+ keywords (cobertura parcial)
- **Ahora**: pagina directamente `catalog[]=4597` (categoría "Palas de pádel") SIN search_text → captura TODO lo que Vinted tiene en esa categoría
- MAX_PAGES subido a 50 (~4.800 items por run)
- Parada incremental: para al encontrar IDs ya en BD (mismo mecanismo que antes)
- Filtros de basura mejorados: adidas campus/spezial/terrex, joma tennis/ace, zapatillas baloncesto, equipaciones fútbol, herramientas

### Wallapop: paginación + más cobertura
**Archivo:** `scripts/scrape-wallapop.ts`
- Paginación añadida: de 40 items por keyword → hasta 200 (5 páginas × 40)
- Parada incremental por IDs conocidos
- Keywords nuevas añadidas: tecnifibre, joma padel, varlion, black crown, royal padel, oxdog
- Nota: el category_id de Wallapop es **12579** (confirmado en extensión Chrome)

### Extensión Chrome: barrido de categoría completa
**Archivo:** `C:\chollo-padel-extension\background.js`
- Nueva función `runCategorySwipe()`: pagina `category_id=12579` sin keywords → captura toda la categoría de palas en Wallapop
- Alarm automático: una vez al día (`category_swipe`, periodInMinutes: 1440)
- Filtros de basura actualizados (sincronizados con el scraper)
- Nuevo botón en popup: "🔍 Barrido categoría completa" (morado)
  - Lanza `runCategorySwipe()` bajo demanda
  - Mensaje de estado durante la ejecución

---

## 📊 Estado de tiendas (2 junio 2026)

### ✅ Funcionando en GH Actions (último scrape hoy)

| Tienda | Productos | Matches | Última ejecución |
|--------|-----------|---------|-----------------|
| Padel Nuestro | 823 | 449 | hoy 09:07 |
| PadelZoom | 749 | 557 | hoy 09:14 |
| Tienda PadelPoint | 822 | 329 | hoy 09:18 |
| Street Padel | 433 | 225 | hoy 09:23 |
| Zona de Padel | 460 | 232 | hoy 09:28 |
| Padel Pro Shop | 495 | 235 | hoy 09:02 |
| Padel Ibérico | 333 | 96 | hoy 09:08 |
| Tennis-Point | 242 | 19 | hoy 09:04 |
| Padel Market | 250 | 144 | hoy 09:06 |
| Padel Coronado | 117 | 64 | hoy 09:05 |
| Mister Padel | 949 | 78 | ayer 20:01 |

### ⚠️ En GH Actions pero scrapeando 0 productos (problemas de acceso/estructura)

| Tienda | Motivo probable |
|--------|----------------|
| Decathlon ES | Protección anti-bot / estructura cambiada |
| Roma Sport | Protección anti-bot (scrapeó 0 hoy) |
| Padel Vice | Protección anti-bot |
| SmashInn | Protección anti-bot o estructura |
| Time2Padel | Protección anti-bot o estructura |
| StarVie Oficial | Solo 10 productos (catálogo propio muy limitado) |
| Ofertas de Padel | No corrió hoy (solo ayer 19:06) |

### ❌ Scripts existentes pero NO en GH Actions (nunca han corrido)

| Tienda | Archivo | Estado |
|--------|---------|--------|
| Padel Shop | `scrapers/padelshop.js` | Sin logs |
| Padel Kiwi | `scrapers/padelkiwi.js` | Sin logs |
| Padel Spain | `scrapers/padelspain.js` | Sin logs |
| Bullpadel Oficial | `scrapers/bullpadel.js` | Sin logs |
| Nox Oficial | `scrapers/nox.js` | Sin logs |
| Siux Oficial | `scrapers/siux.js` | Sin logs |
| Vibora Oficial | `scrapers/vibora.js` | Sin logs |
| Miravia | `scrapers/miravia.js` | En Grupo C, continue-on-error |
| Amazon ES | `scrapers/amazon.js` | En Grupo C, continue-on-error |

### 🔍 Tiendas grandes que faltan completamente

- **PadelNuestro** (ya tenemos ✓)
- **Padelmania** — gran tienda, sin scraper
- **Padelstar** — sin scraper
- **Padelgalaxy** — sin scraper
- **JD Sports padel** — sin scraper
- **El Corte Inglés padel** — sin scraper
- **Sprinter padel** — sin scraper

---

---

## ✅ Sesión continuación 2 junio (tarde) — Segunda mano + matcher

### Extensión Chrome — rediseño completo de lógica de scraping
**Archivo:** `C:\chollo-padel-extension\background.js` + `config.js` + `popup.html/js`

**Lógica anterior:** `runScraper()` buscaba solo por categoría (`category_id=12579`) sin keywords.
**Lógica nueva:**
- Cada 10 min: itera **todos los keywords** de `CONFIG.KEYWORDS` usando `scrapeKeyword(keyword, idsEnBD)` — para al encontrar el primer ID conocido en BD (incremental), recupera `condition` vía `fetchItemDetail`
- Gap > 30 min detectado → `runCatchup(lastRun)` que pagina hacia atrás por keyword hasta `lastRun`
- Al activar/recargar la extensión → `runScraper()` inmediato (no espera al alarm de 1 min)
- Eliminadas: `runCategorySwipe()`, alarm diario (redundante)

**Keywords:** 110+ keywords optimizados + `'pala padel'` al inicio de la lista. Correcciones:
- HEAD: añadido sufijo "padel" (`head extreme padel`, `head speed padel`...) para no capturar tenis
- ADIDAS: `adidas drive padel`, `adidas rx padel`... (ídem)
- WILSON: añadidos `wilson endure`, `wilson optix`, `wilson defy`; `wilson carbon padel`
- BABOLAT: simplificado a `babolat viper` (cubre Technical/Air/Counter), añadido `vertuo`, `veron`
- BULLPADEL: añadido `bullpadel ionic`
- JOMA: simplificado, eliminadas variantes demasiado específicas

**`MARCAS_EN_KEYWORD` ampliado:** Enebe, Kombat, Slazenger, Kaitt, Lok, Star Vie, Vibor-a...

**Bug fix:** `detectarMarca('')` → `detectarMarca(item.title ?? '')` (antes todos los items de categoría quedaban con `marca: null`)

**Popup rediseñado:**
- Indicador "Modo próxima ejecución": verde Normal / ámbar Catch-up (X min)
- Muestra número de keywords activos
- Botón "Forzar catch-up completo" (pagina todo sin límite de fecha)
- Eliminado botón "Barrido categoría completa" (función eliminada)

**Versión:** 2.0 → 3.0

---

### scrape-vinted.ts — migración a keywords (v5)
**Archivo:** `chollo-padel-fase2-v2/chollo-padel-v2/scripts/scrape-vinted.ts`

**Lógica anterior (v4):** `scrapeCategory()` — paginaba `catalog[]=4597` con `search_text='pala padel'` sin keywords
**Lógica nueva (v5):**
- Itera los mismos 110+ keywords + `'pala padel'` de la extensión
- `scrapeKeyword(keyword, auth, idsEnBD)`: pagina `catalog[]=4597` con el keyword como `search_text`, para al encontrar ID conocido
- **Filtro positivo `PALABRAS_PALA`**: el título debe contener al menos una de: pala, padel, pádel, racchetta padel, raquette padel... (necesario porque `catalog[]=4597` en Vinted es categoría amplia que incluye ropa, zapatillas, accesorios)
- HTTP 400 tratado como fin de paginación (Vinted corta en ~pág 10-11)
- `MAX_PAGES_PER_KW = 10`
- Detecta gap desde último scrape y muestra modo Normal/Catch-up en logs
- Dedup cross-keyword antes del upsert
- `EXCLUIR_SCRAPER` ampliado: `beach tennis`, `falda`, `skort`, `longsleeve`, `salopette`, `saia`, `vestido`, `frontenis`, `3 raquetes`, `lot 3`

**692 items basura eliminados de BD** (filtro positivo aplicado retroactivamente)

---

### match-pala-id.ts — fuzzy más estricto + columna año
**Archivo:** `chollo-padel-fase2-v2/chollo-padel-v2/scripts/match-pala-id.ts`

**Thresholds subidos:**
- `PARTIAL_MATCH_THRESHOLD`: 0.60 → 0.75
- `PARTIAL_MATCH_THRESHOLD_SOFT`: 0.50 → 0.65 (con año + jugador)
- `PARTIAL_MATCH_THRESHOLD_MIN`: 0.40 → 0.55 (título corto ≤5 tokens)

**Columna `año` en `wallapop_cache`:**
- Añadida columna `año integer` en BD
- El matcher ahora copia el `año` de la pala del catálogo al asignar `pala_id` (en `matchPalaIds()` y en `main()`)
- Así el año es fiable (del catálogo), no extraído del título del anuncio

---

### app/api/chollos/route.ts — filtro 2024 hardcodeado
- `MIN_ANO`: antes `getFullYear() - 2` (rolling, en 2027 excluiría 2024) → ahora `2024` fijo

### scripts/top-oportunidades.ts — filtro duro 2024+
- Añadido filtro: si `extraerAnio(title) !== null && anio < 2024` → descartado
- Los anuncios sin año explícito en el título siguen entrando (penalizados por `scoreAnio`)

---

### review-nomatch.yml + review-nomatch.ts — revisión diaria 07:00
**Archivos:** `.github/workflows/review-nomatch.yml`, `scripts/review-nomatch.ts`

Nuevo workflow que corre cada día a las 07:00 UTC (09:00 España verano):
- Total sin `pala_id`, desglose por estado (no_match, ambiguous, sin_intentar)
- Agrupado por marca detectada con ejemplos de títulos
- Items ≥100€ sin match (potenciales chollos perdidos)
- Visible en pestaña Actions de GitHub cada mañana

---

## ⚠️ Pendiente / Issues conocidos

### Precios tiendapadelpoint
- La heurística IVA adaptativa cubre la mayoría de casos pero es imperfecta
- La única solución 100% fiable sería visitar cada ficha de producto (demasiado lento)
- Vigilar en próximas sesiones si hay productos mal calculados

### Joma Blast/Hyper HRD no salen en chollos
- `fuentes_count = 1` en price_reference (Roma Sport excluida del recálculo)
- Necesitan que otra tienda las scrapee para llegar a MIN_FUENTES=2
- Roma Sport (119.99€) pasa todas las guardias si se añade otra fuente

### Scrapers con 0 productos
- Roma Sport, Decathlon, PadelVice, SmashInn, Time2Padel necesitan revisión
- Probable bloqueo por Cloudflare/bot-detection en servidor de GH Actions

---

## 🔗 Referencias del proyecto

- **Web:** https://www.huntpadel.com
- **Vercel project:** `prj_wnfDiETPBP4VgmvG7uLQDaRSkeEa`
- **Supabase:** `vgbyhdnhsngaehruirwb`
- **Repo raíz (git):** `C:\chollo-padel`
- **App:** `C:\chollo-padel\chollo-padel-fase2-v2\chollo-padel-v2`
- **Extensión Chrome:** `C:\chollo-padel-extension` (no requiere commit, recargar en chrome://extensions)
- **Wallapop category_id palas:** `12579`
- **Vinted catalog palas:** `4597`
- **Node en Windows:** `& "C:\Program Files\nodejs\node.exe"`
- **Purge vendidos:** `node scripts/purge-sold-items.js`
