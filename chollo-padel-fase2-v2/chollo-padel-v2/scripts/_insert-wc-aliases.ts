import { createClient } from '@supabase/supabase-js'
import { normalizar } from './extract-atributos'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)

// pala_id → titulo en padelmarket
const ALIASES: { pala_id: string; titulo: string }[] = [
  { pala_id: '69547400-8c54-44cb-8bef-e0d306038d65', titulo: 'ADIDAS WORLD CUP Italy 2026' },
  { pala_id: 'b6c4644a-e7b8-4999-9318-717cd958474e', titulo: 'ADIDAS WORLD CUP Belgium 2026' },
  { pala_id: 'e02cab16-7dc9-4500-8d61-7ef8f7a07f96', titulo: 'ADIDAS WORLD CUP Colombia 2026' },
  { pala_id: '16f6a2f5-9ce9-44b6-b910-1b33427743f0', titulo: 'ADIDAS WORLD CUP USA 2026' },
  { pala_id: '2a22bc73-278e-42b9-a969-895a60eae3ae', titulo: 'ADIDAS WORLD CUP Germany 2026' },
  { pala_id: 'ed9c1793-98d7-4086-8346-5ff4491edb34', titulo: 'ADIDAS WORLD CUP Argentina 2026' },
  { pala_id: '1f4fef08-600d-4bc3-888d-3c29aab9c467', titulo: 'ADIDAS WORLD CUP Spain 2026' },
  { pala_id: 'dd1f2933-1529-42df-8233-eb45ac2c794c', titulo: 'ADIDAS WORLD CUP England 2026' },
  { pala_id: '725fadf2-9c00-42f2-b04f-3141841a5158', titulo: 'ADIDAS WORLD CUP France 2026' },
]

for (const { pala_id, titulo } of ALIASES) {
  const { error } = await supabase.from('producto_aliases').upsert({
    pala_id,
    texto_original:    titulo,
    texto_normalizado: normalizar(titulo),
    tienda:            'padelmarket',
    confianza:         1.0,
  }, { onConflict: 'tienda,texto_normalizado' })
  console.log(error ? `❌ ${titulo}: ${error.message}` : `✅ ${titulo}`)
}
