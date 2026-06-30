import { createClient } from '@supabase/supabase-js'

// Cliente de admin (SOLO servidor) — usa la Secret key.
// IMPORTANTE: este fichero no debe importarse nunca desde un componente
// 'use client', porque SUPABASE_SECRET_KEY no existe en el bundle del
// navegador (no tiene prefijo NEXT_PUBLIC_) y createClient lanzaría
// "supabaseKey is required" al cargar el módulo.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)
