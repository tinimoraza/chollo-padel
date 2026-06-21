# HuntPadel — Resumen sesión 19 junio 2026

## ✅ Descubrimiento: cron-job.org es el scheduler real del proyecto

El proyecto no depende de Vercel Cron (limitado a 1 ejecución/día en plan Hobby) ni del `schedule:` nativo de GitHub Actions (comentado como `[PAUSADO]` en todos los workflows). El sistema real es **cron-job.org**, un servicio externo gratuito que dispara `POST` contra la API de GitHub:

```
https://api.github.com/repos/tinimoraza/chollo-padel/actions/workflows/<workflow>.yml/dispatches
```

Esto activa el evento `workflow_dispatch` de cada workflow. Todos los 8 jobs estaban **Inactivos** desde el 06/05/2026.

## ✅ Auditoría de los 8 jobs y acción tomada

| Job | Workflow destino | Estado anterior | Acción | Estado final |
|---|---|---|---|---|
| Match Segunda Mano | `match-wallapop.yml` | Inactivo | **Activado** (cada 30 min) | ✅ Activo |
| Audit Matches | `audit-matches.yml` | Inactivo | **Activado** (07:00 y 18:00 UTC) | ✅ Activo |
| Auto Promote | `auto-promote-candidatas.yml` | Inactivo | **Activado** (08:00 UTC) | ✅ Activo |
| Embedding Rematch | `embedding-rematch.yml` | Inactivo | **Eliminado** (workflow roto + job) | ❌ Borrado |
| Review No-Match | `review-nomatch.yml` | Inactivo | **Eliminado** (workflow roto + job) | ❌ Borrado |
| Check Alerts | `check-alerts.yml` | Inactivo | Sin tocar | ⏸️ Inactivo |
| Scraper Vinted | `scrape-vinted.yml` | Inactivo | Sin tocar | ⏸️ Inactivo |
| Top Oportunidades | `top-oportunidades.yml` | Inactivo | Sin tocar | ⏸️ Inactivo |

### Por qué se eliminaron Embedding Rematch y Review No-Match
Ambos workflows llamaban a scripts que ya no existen en el repo (`scripts/match-pala-id.ts` y `scripts/review-nomatch.ts`), borrados en la sesión anterior durante la unificación del matcher de segunda mano. Reactivarlos habría fallado en cada ejecución ("Cannot find module"). Además, la función de Embedding Rematch (fallback semántico) ya está absorbida por el nuevo `matchSecondhandCache` unificado (fuzzy + embedding en un solo paso) que usa Match Segunda Mano.

**Archivos borrados del repo:**
- `.github/workflows/embedding-rematch.yml`
- `.github/workflows/review-nomatch.yml`

**Jobs borrados en cron-job.org:** Embedding Rematch (id 7736487), Review No-Match (id 7736489).

### Por qué los otros 3 quedan inactivos (de momento)
- **Check Alerts**: duplicaría el cron nativo de Vercel (`/api/cron/check-alerts`, 09:00 UTC diario). Activar ambos enviaría alertas duplicadas. Decisión pendiente del usuario.
- **Scraper Vinted**: código sano, pero la ingesta de Vinted está pausada a propósito.
- **Top Oportunidades**: depende de `wallapop_cache`; sin datos frescos no tiene sentido activarlo todavía.

## 📋 Commit pendiente de esta sesión

```bash
# Desde C:\chollo-padel\chollo-padel-v2 (o la raíz del repo, según tu carpeta de trabajo actual)
git add -A
git commit -m "chore: eliminar workflows rotos (embedding-rematch, review-nomatch)"
git push
```

## ℹ️ Nota: extensión Wallapop

La extensión seguía parada a propósito (decisión previa del usuario, no por fallo). El usuario la activa por su cuenta esta sesión — no se ha tocado código ni configuración de la extensión desde aquí.

## 🔗 Referencias

- **cron-job.org:** https://console.cron-job.org/jobs
- **Repo local:** `C:\chollo-padel\chollo-padel-fase2-v2\chollo-padel-v2`
- **Workflows:** `C:\chollo-padel\.github\workflows\`
