import { createClient } from '@supabase/supabase-js'

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
  const { data } = await sb.from('palas_candidatas').select('id, titulo, titulo_normalizado, datos_extraidos').eq('estado', 'ambiguo').order('created_at', { ascending: false })
  data?.forEach((c: any) => {
    const d = c.datos_extraidos as any
    console.log('---')
    console.log('titulo:', c.titulo)
    console.log('norm:  ', c.titulo_normalizado)
    console.log('marca:', d?.marca, '| linea:', d?.linea, '| modelo:', d?.modelo, '| año:', d?.año)
    console.log('candidatos:', JSON.stringify(d?.candidatos_ids ?? d?.candidatos))
  })
}
main().catch(console.error)
