import { createClient } from '@supabase/supabase-js'
async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
  const { data, error } = await sb.from('palas').select('nombre,linea,modelo,variante,año').eq('marca','Nox').ilike('linea','ml10').order('año').order('modelo')
  if (error) { console.error(error); return }
  console.log(JSON.stringify(data, null, 2))
}
main()
