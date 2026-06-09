import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
async function main(){
  const { data, error } = await sb.from('price_sources').select('id,slug').eq('slug','padelnuestro').single()
  console.log('data:', data, 'error:', JSON.stringify(error))
  const { data: d2, error: e2 } = await sb.from('price_sources').select('id,slug').limit(5)
  console.log('list:', d2, 'err2:', JSON.stringify(e2))
}
main()
