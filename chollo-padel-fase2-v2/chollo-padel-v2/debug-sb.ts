import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SECRET_KEY!

console.log('URL:', url)
console.log('KEY length:', key?.length)

async function run() {
  const supabase = createClient(url, key)
  const { data, error } = await supabase.from('price_sources').select('id,slug').eq('slug', 'padelmarket').single()
  console.log('data:', JSON.stringify(data))
  console.log('error:', JSON.stringify(error))
}
run()
