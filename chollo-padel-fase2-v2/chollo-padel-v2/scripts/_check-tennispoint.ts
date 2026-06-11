import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)

async function main() {
  // Estado actual de candidatas tennispoint
  const { data: stats } = await sb.from('palas_candidatas')
    .select('estado')
    .contains('fuentes', ['tennispoint'])

  const byEstado: Record<string, number> = {}
  for (const c of stats ?? []) byEstado[c.estado] = (byEstado[c.estado] ?? 0) + 1
  console.log('=== Estados tennispoint ===')
  for (const [e, n] of Object.entries(byEstado).sort()) console.log(`  ${e}: ${n}`)

  // Pendientes restantes (sin_match reales)
  const { data: pend } = await sb.from('palas_candidatas')
    .select('titulo,precio_min,datos_extraidos')
    .contains('fuentes', ['tennispoint'])
    .eq('estado', 'pendiente')
    .order('titulo')

  if (pend?.length) {
    console.log('\n=== Pendientes sin resolver ===')
    for (const c of pend) {
      const d = c.datos_extraidos as any
      console.log(`  ${c.titulo} | €${c.precio_min} | marca=${d?.marca} linea=${d?.linea} modelo=${d?.modelo} año=${d?.año}`)
    }
  }
  console.log(`\nPendientes: ${pend?.length ?? 0}`)
}
main().catch(console.error)
