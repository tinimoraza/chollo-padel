# HuntPadel — Arquitectura Técnica
*Actualizado: 2026-06-03*

---

## Visión general

HuntPadel es un agregador de chollos de palas de pádel de segunda mano (Wallapop, Vinted) y tiendas online. Detecta anuncios con descuento real respecto al PVP de tienda, los matchea contra un catálogo de palas, y presenta un ranking TOP + alertas a usuarios.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend/API | Next.js (Vercel Hobby) |
| Base de datos | Supabase (PostgreSQL) |
| Scraper Wallapop | Chrome Extension (MV3, background service worker) |
| Scraper Vinted | GitHub Actions + script Node/TSX |
| Scraper tiendas | GitHub Actions + Playwright/Puppeteer |
| CI/CD | GitHub Actions |

---

## Tablas principales de Supabase

| Tabla | Descripción |
|---|---|
| `palas` | Catálogo de palas (1743 modelos). marca, modelo, año, slug, imagen_url |
| `palas_candidatas` | Palas detectadas en tiendas sin match en catálogo. Auto-promovidas si ≥2 fuentes |
| `wallapop_cache` | Anuncios de segunda mano (Wallapop + Vinted). ~2175 items activos |
| `price_snapshots` | Precios scrapeados de tiendas. Con pala_id, confidence, disponible |
| `price_reference` | Precio medio/referencia por pala_id (calculado de price_snapshots) |
| `price_match_cache` | Cache de matches tienda→catálogo para no repetir matching |
| `top_oportunidades` | TOP 10 calculado cada 30 min. Ranking de mejor descuento segunda mano |
| `alertas` | Alertas configuradas por usuarios (pala_id + precio máximo) |
| `notificaciones` | Historial de notificaciones enviadas |
| `match_audit_log` | Log de auditorías de calidad de matches |

---

## Flujo de datos

### Segunda mano (Wallapop)
```
Chrome Extension (cada 10 min)
  → scrapeKeyword() por cada keyword de CONFIG.KEYWORDS
  → fetchItemDetail() para condition + precio real
  → supabaseUpsert() → wallapop_cache (condition, price, url, title...)
  → alarm verify (cada hora): verifica vendidos, enriquece condition vacía
```

**Catch-up**: si gap > 30 min, activa modo catch-up (máx 120 min de lookback para evitar timeout).

### Segunda mano (Vinted)
```
GitHub Actions "Scraper Vinted" (:05 y :35)
  → scrape-vinted.ts: busca por keywords en API vinted.es
  → Filtro calidad: títulos <4 palabras excluidos, EXCLUIR_SCRAPER
  → wallapop_cache (platform='vinted')
```

### Match pala_id (segunda mano)
```
GitHub Actions "Match Segunda Mano" (:15 y :45)
  → GET /api/cron/match-wallapop → matchPalaIds()
  → Fuzzy matcher v17: tokenización + fase estricta + fase parcial
  → Escribe pala_id + match_method='fuzzy_auto' en wallapop_cache
  → Items genéricos sin año → noMatch (no fuzzy_year_ambiguous)
```

**Umbrales match fuzzy:**
- Fase 1 (estricta): todos los tokens del modelo deben estar en el título
- Fase 2 (parcial): ≥75% tokens (65% con año+jugador, 55% título corto)
- Sin año en título → noMatch (filtro duro para el TOP)

### TOP Oportunidades
```
GitHub Actions "Top Oportunidades" (:25 y :55)
  → top-oportunidades.ts
  → Lee wallapop_cache WHERE condition IN (new, un_opened, as_good_as_new)
       AND match_method = 'fuzzy_auto'
       AND año en título >= 2024
  → Cruza con price_reference para calcular descuento real
  → Verifica activos via API Wallapop
  → Escribe top 10 en top_oportunidades
```

### Tiendas (Chollos)
```
Manual (por ahora) / GitHub Actions "Scrape Precios Tiendas" (desactivado)
  → pipeline.js [tienda] → scraper específico
  → price_match_cache: match snapshot URL → pala_id del catálogo
  → price_snapshots: precio, disponible, confidence, pala_id
  → price_reference: recalculada (media de snapshots ≥2 fuentes)
  → /api/chollos: filtra price_snapshots con match_confidence>=0.95, MIN_ANO=2024
```

---

## GitHub Actions — Cadencia diaria

### Cada 30 minutos (operacional)
| Hora | Action | Qué hace |
|---|---|---|
| :05 y :35 | **Scraper Vinted** | Recoge anuncios nuevos de Vinted |
| :15 y :45 | **Match Segunda Mano** | Asigna pala_id a items sin match |
| :25 y :55 | **Top Oportunidades** | Regenera ranking TOP 10 |

### Diario (análisis y mantenimiento — listos a las 08:30 España)
| Hora UTC | Action | Qué hace | Log en disco |
|---|---|---|---|
| 07:00 | **Audit Matches** | Audita y corrige bad matches TOP+CHOLLOS | `logs/audit-matches/` |
| 07:30 | **Embedding Rematch** | ML matching para items no resueltos por fuzzy | `logs/embedding-rematch/` |
| 08:00 | **Auto Promote Candidatas** | Promueve palas nuevas al catálogo | `logs/auto-promote/` |
| 08:15 | **Review No-Match Diario** | Análisis matches OK + motivos no-match | `logs/review-nomatch/` |
| 07:00 y 18:00 | **Audit Matches** | (también a las 18:00) | idem |
| 07:30 y 18:30 | **Embedding Rematch** | (también a las 18:30) | idem |

### Otras
| Action | Frecuencia | Qué hace |
|---|---|---|
| **Check Alerts** | 08:00, 13:00, 19:00 UTC | Envía notificaciones de chollos a usuarios |
| **Scrape Precios Tiendas** | Manual (desactivado) | Scrape de ~10 tiendas online |
| **Test API Wallapop directa** | Manual | Debug del API de Wallapop |

---

## Matcher fuzzy (match-pala-id.ts v17)

### Proceso
1. **Detectar marca** desde `wallapop_cache.marca` o inferida del título
2. **Tokenizar** título y modelo (sin marca, sin año, sin jugadores)
3. **Fase 1** (estricta): todos los tokens no-color del modelo en el título
4. **Fase 2** (parcial): si fase 1 vacía, ratio ≥75% con múltiples desempates
5. **Desempates**: diferenciadores, jugadores, versión X.Y, especificidad, año más reciente
6. **Resultado**: `fuzzy_auto` (match) | `no_match` | `ambiguous`

### Inyecciones específicas
- `AT10 + 18K` (múltiples versiones): inyecta `genius`+`alum`
- `AT10 + attack`: inyecta `genius`
- `AT10 + 12K`: inyecta `genius`
- `AT10 + attack`: inyecta `12k`+`alum`
- `EA10 + 18K`: inyecta `genius`+`alum`

### Normalizaciones en tokenizador
- `hrd+` / `hdr+` / `hdr` → `hrd`
- `hard` → `hrd`, `soft` → `sft`, `ctr` → `ctrl`
- `W` / `04w` → `woman` (versiones femeninas)
- `pro+` / `pro plus` → `proplus`
- `proline` / `pro line` → `line`
- Colores en KEEP_WORDS y TOKENS_DIFERENCIADORES (distinguen variantes)

### Filtros del TOP
- `condition IN (new, un_opened, as_good_as_new)`
- `match_method = 'fuzzy_auto'` (no genéricos, no ambiguos)
- Año en título ≥ 2024 (filtro duro — sin año = excluido)
- Precio ≥ 55€
- Descuento ≥ 25% sobre price_reference
- price_reference con ≥ 2 fuentes de tiendas

---

## Chrome Extension (Wallapop)

**Alarms:**
- `scrape`: cada 10 min — recoge anuncios nuevos de Wallapop
- `verify`: cada hora — verifica vendidos + enriquece condition vacía

**Modo catch-up:** si gap > 30 min:
- Lookback limitado a 120 min (evita timeout de service worker)
- Si ≤80 items: llama `fetchItemDetail` (condition + precio real)
- Si >80 items: inserta rápido, condition se enriquece en alarm verify

**Keywords:** 141 términos de búsqueda (marcas + modelos específicos)

**API Wallapop:** `https://api.wallapop.com/api/v3/items/{id}` para condition/precio/estado

---

## Calidad de matches (estado actual 2026-06-03)

| Plataforma | Total items | Con pala_id | % match |
|---|---|---|---|
| Wallapop | ~380 | ~163 | **43%** |
| Vinted | ~1800 | ~595 | **33%** |

**Principales causas de no-match en Vinted:**
- Ratio tokens insuficiente (415): modelos viejos, genéricos, marcas nicho
- Bloqueado por diferenciador (313): título sin token requerido (ej: alum, xtrem)
- Sin marca detectada (210): títulos en italiano/francés/portugués sin info de modelo
- Marca sin catálogo (22): prince, sane, slazenger, hirostar, cork...

---

## Logs disponibles en `logs/`

| Carpeta | Contenido | Frecuencia |
|---|---|---|
| `logs/review-nomatch/` | Matches OK + motivos no-match + chollos perdidos | Diario 08:15 UTC |
| `logs/audit-matches/` | Issues detectados + auto-correcciones TOP/CHOLLOS | 07:00 y 18:00 UTC |
| `logs/embedding-rematch/` | Items matcheados por ML, confidence scores | 07:30 y 18:30 UTC |
| `logs/auto-promote/` | Palas promovidas al catálogo desde candidatas | Diario 08:00 UTC |

---

## Rutina diaria de análisis (08:30 España)

1. Leer `logs/audit-matches/` → ¿se auto-corrigieron bad matches?
2. Leer `logs/embedding-rematch/` → ¿el ML matcheó items que el fuzzy no pudo?
3. Leer `logs/auto-promote/` → ¿se añadieron palas nuevas al catálogo?
4. Leer `logs/review-nomatch/` → ¿qué no matchea y por qué? ¿hay chollos perdidos?
5. Actuar: añadir modelos al catálogo, ajustar matcher, mejorar keywords

---

## Catálogo de palas

- **1743 modelos** de ~32 marcas
- Fuentes: padelful.com, padelzoom.com, imports manuales
- Auto-promoción: `palas_candidatas` → `palas` cuando ≥2 tiendas distintas lo venden

### Modelos añadidos manualmente (2026-06-03)
Adidas Metalbone Pro EDT 2026, Arrow Hit Pro EDT 2026, Nox EA10 Ventus Hybrid/Attack 2026, Bullpadel Pearl 2026, Bullpadel Neuron 2026, Joma Slam Pro 2025, Nox AT10 Genius Attack 2025/2026, Star Vie Basalto 2025, Bullpadel Vertex XS 2026, Star Vie Metheora Black 2023, Nox Future Hybrid 2025, Babolat Vertuo 2025/2026, Wilson Bela Pro V3 2025 (año corregido)
