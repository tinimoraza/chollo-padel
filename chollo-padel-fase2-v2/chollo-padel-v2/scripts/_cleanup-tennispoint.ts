import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)

async function main() {
  // 1. Ignorar candidatas con "Pala de pádel" en el título (versiones sucias pre-fix)
  const { data: sucias, error: e1 } = await sb.from('palas_candidatas')
    .update({ estado: 'ignorada' })
    .ilike('titulo', '%Pala de pádel%')
    .contains('fuentes', ['tennispoint'])
    .in('estado', ['pendiente', 'ambiguo'])
    .select('titulo')

  console.log(`Limpiadas con "Pala de pádel": ${sucias?.length ?? 0}`)

  // 2. Ignorar candidatas Rox y RS by Robin (marcas excluidas)
  const { data: excluidas, error: e2 } = await sb.from('palas_candidatas')
    .update({ estado: 'ignorada' })
    .or('titulo.ilike.Rox %,titulo.ilike.RS by Robin%')
    .contains('fuentes', ['tennispoint'])
    .in('estado', ['pendiente', 'ambiguo'])
    .select('titulo')

  console.log(`Limpiadas Rox/RS: ${excluidas?.length ?? 0}`)

  if (e1) console.error('Error 1:', e1)
  if (e2) console.error('Error 2:', e2)
}
main().catch(console.error)
