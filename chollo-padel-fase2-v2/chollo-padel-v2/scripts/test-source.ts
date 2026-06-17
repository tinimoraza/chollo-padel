import { createClient } from '@supabase/supabase-js'

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
  const { data, error } = await supabase.from('price_sources').select('id,slug,activa').eq('slug','padelmarket').single()
  console.log('data:', JSON.stringify(data))
  console.log('error:', JSON.stringify(error))
  
  // also list all slugs
  const { data: all } = await supabase.from('price_sources').select('id,slug').order('id')
  console.log('all:', JSON.stringify(all))
}

main()
