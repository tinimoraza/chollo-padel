# 🏓 CHOLLO PADEL — Guía de despliegue

## Lo que tienes aquí

```
chollo-padel/
├── app/
│   ├── page.tsx              ← Página principal
│   ├── layout.tsx            ← Layout raíz
│   └── api/
│       ├── search/route.ts   ← Búsqueda (sin CORS)
│       ├── alerts/route.ts   ← CRUD de alertas
│       └── cron/route.ts     ← Cron cada hora
├── components/
│   ├── SearchPanel.tsx       ← Buscador + resultados
│   ├── Sidebar.tsx           ← Alertas + populares
│   └── AlertModal.tsx        ← Modal nueva alerta
├── lib/
│   ├── supabase.ts           ← Cliente Supabase
│   └── wallapop.ts           ← API de búsqueda
├── supabase-setup.sql        ← ← ← EJECUTA ESTO PRIMERO
├── vercel.json               ← Cron cada hora
└── .env.local.example        ← Variables que necesitas
```

---

## PASO 1 — Crear cuenta en Supabase (5 min)

1. Ve a **supabase.com** → Sign Up (gratis)
2. Click **"New project"**
   - Nombre: `chollo-padel`
   - Contraseña: una buena (guárdala)
   - Región: **West EU (Ireland)** (más cercana a España)
3. Espera 2 minutos mientras se crea

---

## PASO 2 — Crear las tablas

1. En tu proyecto Supabase → **SQL Editor** → **New query**
2. Copia todo el contenido de `supabase-setup.sql`
3. Pégalo y pulsa **RUN**
4. Deberías ver "Success. No rows returned"

---

## PASO 3 — Copiar las credenciales

En Supabase → **Settings** → **API**:

- `Project URL` → es tu `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` → es tu `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` → es tu `SUPABASE_SERVICE_ROLE_KEY` ⚠️ NO compartas esto

---

## PASO 4 — Crear cuenta en Resend (emails gratis)

1. Ve a **resend.com** → Sign Up (gratis, 3000 emails/mes)
2. **API Keys** → **Create API Key**
3. Guarda la clave: empieza por `re_...`

> ⚠️ Para mandar emails necesitas verificar un dominio en Resend.
> Si no tienes dominio, puedes usar el dominio de Resend para pruebas.

---

## PASO 5 — Subir a Vercel

1. Sube la carpeta a GitHub (nuevo repositorio)
2. Ve a **vercel.com** → **New Project** → importa tu repo
3. En **Environment Variables** añade:

| Variable | Valor |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | tu URL de Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | tu anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | tu service role key |
| `RESEND_API_KEY` | tu clave de Resend |
| `CRON_SECRET` | una cadena aleatoria larga |

4. Click **Deploy** → en 2 minutos estará online

---

## PASO 6 — Verificar el cron

El archivo `vercel.json` ya configura el cron para que corra cada hora.
Puedes verlo en Vercel → tu proyecto → **Cron Jobs**.

Para probarlo manualmente:
```
GET https://tu-app.vercel.app/api/cron
Authorization: Bearer TU_CRON_SECRET
```

---

## ¿Problemas?

- **CORS en local**: Normal. La búsqueda usa `/api/search` que corre en el servidor.
  Usa `npm run dev` en lugar de abrir el HTML directamente.
- **Emails no llegan**: Verifica el dominio en Resend.
- **Alertas no se guardan**: Comprueba las variables de entorno en Vercel.
