import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)

async function main() {
  // fuentes es array, usamos contains para filtrar por tennispoint
  const { data, error } = await sb.from('palas_candidatas')
    .select('titulo,precio_min,precio_max,datos_extraidos,estado')
    .contains('fuentes', ['tennispoint'])
    .order('titulo')
    .limit(60)

  if (error) { console.error(error); return }

  for (const c of data ?? []) {
    const d = c.datos_extraidos as any
    console.log(`[${c.estado}] ${c.titulo} | €${c.precio_min} | marca=${d?.marca} linea=${d?.linea} modelo=${d?.modelo} año=${d?.año}`)
  }
  console.log(`\nTotal: ${data?.length}`)
}
main().catch(console.error)
