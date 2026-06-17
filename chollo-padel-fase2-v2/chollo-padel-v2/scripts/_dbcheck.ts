import { createClient } from '@supabase/supabase-js'
async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
  
  const { data, error, count } = await sb.from('palas_candidatas').select('estado', { count: 'exact' }).limit(5)
  console.log('count:', count, 'error:', error?.message, 'data:', JSON.stringify(data))
  
  const { data: d2, error: e2 } = await sb.from('palas').select('id, nombre, marca').ilike('nombre', '%CANYON%').limit(10)
  console.log('canyon:', JSON.stringify(d2), e2?.message)
}
main().catch(console.error)
