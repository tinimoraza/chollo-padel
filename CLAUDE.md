# Notas del proyecto — chollo-padel

## Reglas de sesión (siempre en vigor)

- **Nunca ejecutar `git commit` / `git push`** — dar comandos exactos copy-paste para que los ejecute Patricia.
- **Nunca dar comandos sin ruta completa** cuando el binario no está en PATH.
- **Verificar siempre sintaxis TypeScript** (`tsc --noEmit`) antes de declarar un cambio como listo.
- **Todas las respuestas a Patricia en español.**
- **No inventar hallazgos** — cada afirmación sobre qué está roto/funcionando debe estar respaldada por datos reales verificados.

---

## Estructura del repo

```
chollo-padel/
├── chollo-padel-fase2-v2/chollo-padel-v2/   ← código principal
│   ├── scripts/                              ← TypeScript: pipeline, scrapers, top, notify…
│   ├── app/                                 ← Next.js (web pública huntpadel)
│   ├── .env.local                           ← variables de entorno (Supabase, Telegram…)
│   └── package.json
├── scripts-local/                           ← PowerShell: pipeline local en Windows
│   ├── run-pipeline-local.ps1               ← script maestro (lanza los 4 grupos en paralelo)
│   ├── run-grupo-a.ps1                      ← grupo A: padelnuestro, time2padel, padelproshop…
│   ├── run-grupo-b.ps1                      ← grupo B: padelzoom, ofertasdepadel, padelmarket…
│   ├── run-grupo-c.ps1                      ← grupo C: streetpadel, m1padel, justpadel…
│   └── run-grupo-playwright.ps1             ← grupo PW: allforpadel, padeliberico, padelcoronado…
├── chollo-padel-tiendas-extension/          ← extensión Chrome (tiendas WooCommerce / Cloudflare)
│   ├── background.js
│   ├── config.js
│   ├── popup.html / popup.js
│   └── manifest.json
└── pipeline-local.log                       ← log del último ciclo del pipeline local
```

---

## Supabase

- **Proyecto:** `vgbyhdnhsngaehruirwb`
- **URL:** `https://vgbyhdnhsngaehruirwb.supabase.co`
- Variables de entorno en `chollo-padel-fase2-v2/chollo-padel-v2/.env.local`

### Tablas principales
| Tabla | Contenido |
|---|---|
| `palas` | Catálogo de palas (nombre, marca, línea, año, imagen, precio_referencia…) |
| `product_aliases` | Alias de nombres por tienda → pala_id |
| `price_sources` | Tiendas registradas (id, nombre, source_key, url) |
| `price_snapshots` | Precios actuales por tienda (precio, disponible, sku, codigo_descuento…) |
| `price_history_log` | Histórico de precios (insert-only) |
| `wallapop_cache` | Anuncios Wallapop/Vinted (candidatas de segunda mano) |
| `candidatas` | Candidatas procesadas (matched/pendiente/descartada) |
| `clubes_equipos` | Equipos de pádel (para /clubes) |
| `clubes_jugadores` | Jugadores por equipo |
| `log_fusiones` | Historial de fusiones de palas duplicadas |

---

## Pipeline local (Task Scheduler Windows)

Programado a las **08:00** en Windows Task Scheduler, ejecuta `run-pipeline-local.ps1`.

### Qué hace
1. Mata procesos zombie del run anterior (PowerShell + node)
2. Lanza los 4 grupos de scrapers **en paralelo** (grupos A, B, C, Playwright)
3. Espera hasta 90 min a que terminen
4. Ejecuta `post-pipeline.ts` (recalcular precios + mediana)
5. Ejecuta `match-segunda-mano.ts` (match Wallapop/Vinted contra catálogo)
6. Ejecuta `notify-chollos-telegram.ts` (notificación si hay chollos nuevos)

### Logs
| Archivo | Contenido |
|---|---|
| `pipeline-local.log` | Log maestro completo (rotación automática si supera 5 MB) |
| `pipeline-local-a.log` | Log grupo A |
| `pipeline-local-b.log` | Log grupo B |
| `pipeline-local-c.log` | Log grupo C |
| `pipeline-local-pw.log` | Log grupo Playwright |

### Lanzar manualmente
```powershell
& C:\chollo-padel\scripts-local\run-pipeline-local.ps1
```

### Si los logs están bloqueados (procesos zombie)
```powershell
Get-Process powershell | Where-Object { $_.Id -ne $PID } | Stop-Process -Force
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
```
El script ya lo hace automáticamente al arrancar, pero si se lanza desde PowerShell mientras hay un run activo puede requerir hacerlo a mano.

### Nota sobre npx
Todos los scripts usan `npx --yes tsx` (con `--yes`) para que npx acepte automáticamente instalar nuevas versiones de tsx sin pedir confirmación interactiva.

---

## Scripts TypeScript principales

Todos en `chollo-padel-fase2-v2/chollo-padel-v2/scripts/`. Se ejecutan con:
```bash
npx --yes tsx --env-file=.env.local scripts/NOMBRE.ts [args]
```

| Script | Qué hace |
|---|---|
| `pipeline-tiendas.ts <tienda>` | Scraping de una tienda + match + upsert en BD |
| `post-pipeline.ts` | Recalcular precio_referencia (mediana) de todas las palas con snaps nuevos |
| `match-segunda-mano.ts` | Matchear wallapop_cache (Wallapop + Vinted) contra catálogo |
| `top-oportunidades.ts` | Calcular y devolver ranking de mejores oportunidades de segunda mano |
| `notify-chollos-telegram.ts` | Notificar chollos de tiendas a Telegram (consume /api/chollos) |
| `auto-promote-candidatas.ts` | Promocionar automáticamente candidatas con match de alta confianza |
| `detectar-duplicados.ts` | Detectar palas duplicadas en catálogo por firma combinada |
| `limpiar-duplicados-catalogo.ts` | Mergear duplicados automáticamente |

---

## Web pública — huntpadel

Next.js en `chollo-padel-fase2-v2/chollo-padel-v2/app/`. Desplegada en Vercel.

### Secciones
| Ruta | Qué muestra |
|---|---|
| `/chollos` | Palas de tiendas con ≥15% de descuento sobre precio de referencia |
| `/top` | Top oportunidades de segunda mano (Wallapop/Vinted) por score |
| `/palas` | Catálogo completo con precios por tienda, gráfico histórico, filtro chollos |
| `/palas/[slug]` | Ficha de pala individual |
| `/buscar` | Búsqueda libre |
| `/marcas/[marca]` | SEO por marca |
| `/clubes` | Área privada (magic link) — gestión de equipos |

### API interna
| Endpoint | Qué devuelve |
|---|---|
| `/api/chollos` | Lista de chollos activos (precio actual vs referencia) |
| `/api/top` | Top oportunidades segunda mano |

---

## GitHub Actions (workflows)

En `.github/workflows/`. Los principales activos:

| Workflow | Cuándo corre | Qué hace |
|---|---|---|
| `pipeline-tiendas-temp.yml` | Cron (varios grupos) | Scraping de tiendas en GitHub Actions |
| `dispatch-scraper-vinted.yml` | cron-job.org cada 30 min | Lanzar scraper Vinted |
| `scrape-rapido-shopify.yml` | workflow_dispatch | Scraping rápido de 5 tiendas Shopify |

**Nota:** el pipeline de tiendas corre también en local (Task Scheduler 08:00) como alternativa/redundancia al workflow de GitHub Actions.

---

## Extensión Chrome — tiendas WooCommerce

Ver documentación completa en `chollo-padel-extension/CLAUDE.md`.

Ubicación del código: `chollo-padel-tiendas-extension/`

Corre en background cada 2h. Scrapea tiendas WooCommerce con Cloudflare (padelcoronado, padelstyle, padeltienda). Los datos van directo a Supabase.

---

## Comandos frecuentes

### Verificar TypeScript
```bash
cd chollo-padel-fase2-v2/chollo-padel-v2
npx tsc --noEmit
```

### Git (dar a Patricia para que ejecute)
```
cd C:\chollo-padel
git add <archivos>
git commit -m "descripción"
git push
```

### Ver log del pipeline local (tail)
```powershell
Get-Content C:\chollo-padel\pipeline-local.log -Tail 50
```
