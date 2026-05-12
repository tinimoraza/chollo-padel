import { createClient } from '@supabase/supabase-js'

// Cliente público (para el navegador) — usa la Publishable key
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)

// Cliente de admin (solo en el servidor) — usa la Secret key
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!   // ← corregido (era NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
)
