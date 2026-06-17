import { createClient } from '@supabase/supabase-js'

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

async function main() {
  const r = await s.from('price_sources').select('id,slug').eq('slug','padelmarket').single()
  console.log('data:', JSON.stringify(r.data))
  console.log('error:', JSON.stringify(r.error))
}
main()
