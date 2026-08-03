# HuntPadel — Guía de despliegue
*Actualizado: 2026-08-03*

---

## Variables de entorno

En `chollo-padel-fase2-v2/chollo-padel-v2/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://vgbyhdnhsngaehruirwb.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

Las mismas variables tienen que estar configuradas en Vercel (Settings → Environment Variables).

---

## Despliegue web (Vercel)

La web se despliega automáticamente en Vercel al hacer `git push` a `main`.

- Proyecto Vercel: **huntpadel**
- Dominio: **huntpadel.com**
- Root directory: `chollo-padel-fase2-v2/chollo-padel-v2`

Para forzar un redeploy sin cambios de código: Vercel dashboard → Deployments → Redeploy.

---

## Pipeline de tiendas en producción

### GitHub Actions (principal)

Workflow: `.github/workflows/pipeline-tiendas-temp.yml`
Corre 2x/día vía cron. Grupos A, B, C y Playwright en jobs paralelos.

### Task Scheduler Windows (redundancia)

Script: `C:\chollo-padel\scripts-local\run-pipeline-local.ps1`
Configurado en el Programador de Tareas de Windows a las **08:00** diario.

---

## Supabase

- **Proyecto:** `vgbyhdnhsngaehruirwb`
- **Dashboard:** https://supabase.com/dashboard/project/vgbyhdnhsngaehruirwb
- Migraciones: aplicar manualmente vía SQL Editor o MCP de Supabase

---

## Extensión Chrome

1. Abrir `chrome://extensions`
2. Activar "Modo desarrollador"
3. "Cargar sin empaquetar" → seleccionar `chollo-padel-tiendas-extension/`
4. Para actualizar tras cambios: botón "Recargar" en la extensión

---

## Compilar herramientas Python

Desde `C:\chollo-padel-extension\`:

```powershell
# Verificar sintaxis primero
python -c "import py_compile; py_compile.compile('gestor_candidatas.py', doraise=True)"

# Compilar (usar specs ya existentes)
C:\Users\adominguez\AppData\Local\Python\pythoncore-3.14-64\Scripts\pyinstaller.exe --onefile --windowed --name GestorCandidatas gestor_candidatas.py
C:\Users\adominguez\AppData\Local\Python\pythoncore-3.14-64\Scripts\pyinstaller.exe --onefile --windowed --name GestorClub gestor_club.py
C:\Users\adominguez\AppData\Local\Python\pythoncore-3.14-64\Scripts\pyinstaller.exe --onefile --windowed --name PipelineLauncher pipeline_launcher.py
```

Los `.exe` quedan en `dist\`.
