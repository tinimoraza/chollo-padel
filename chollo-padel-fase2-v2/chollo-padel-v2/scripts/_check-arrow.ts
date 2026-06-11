import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)

async function main() {
  const { data } = await sb.from('palas')
    .select('nombre,linea,modelo,variante,año')
    .eq('marca', 'Adidas')
    .ilike('linea', '%arrow%')
    .order('nombre')
  console.log('Arrow en catálogo:')
  for (const p of data ?? []) console.log(`  ${p.nombre} | linea=${p.linea} modelo=${p.modelo} año=${p.año}`)
  if (!data?.length) console.log('  (ninguna)')
}
main().catch(console.error)
