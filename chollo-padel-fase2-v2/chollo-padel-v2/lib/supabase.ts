import { createClient } from '@supabase/supabase-js'

// Cliente público (para el navegador) — usa la Publishable key.
// IMPORTANTE: este fichero se importa desde componentes 'use client'
// (p.ej. app/clubes/login, app/clubes/panel), así que NO debe crear aquí
// ningún cliente que dependa de variables sin prefijo NEXT_PUBLIC_ — esas
// variables no existen en el bundle del navegador y romperían la hidratación.
// El cliente de admin (Secret key) vive aparte, en lib/supabase-admin.ts.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)
