import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const TTL_MINUTES = 5

export async function getCached<T>(key: string): Promise<T | null> {
  // DESACTIVADO TEMPORALMENTE — siempre va a Supabase
  return null
}

export async function setCached<T>(key: string, results: T): Promise<void> {
  await supabase.from('search_cache').upsert(
    { cache_key: key, results, created_at: new Date().toISOString() },
    { onConflict: 'cache_key' }
  )
}
