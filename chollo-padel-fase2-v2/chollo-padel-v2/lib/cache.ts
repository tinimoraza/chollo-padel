import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const TTL_MINUTES = 5

export async function getCached<T>(key: string): Promise<T | null> {
  const { data, error } = await supabase
    .from('search_cache')
    .select('results, created_at')
    .eq('cache_key', key)
    .single()

  if (error || !data) return null

  const ageMs = Date.now() - new Date(data.created_at).getTime()
  if (ageMs > TTL_MINUTES * 60 * 1000) {
    await supabase.from('search_cache').delete().eq('cache_key', key)
    return null
  }

  return data.results as T
}

export async function setCached<T>(key: string, results: T): Promise<void> {
  await supabase.from('search_cache').upsert(
    { cache_key: key, results, created_at: new Date().toISOString() },
    { onConflict: 'cache_key' }
  )
}
