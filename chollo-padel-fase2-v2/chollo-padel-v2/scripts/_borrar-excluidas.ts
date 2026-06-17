import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  'https://vgbyhdnhsngaehruirwb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZnYnloZG5oc25nYWVocnVpcndiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODExMTY4NSwiZXhwIjoyMDkzNjg3Njg1fQ.UR7pY7dpHasy7gtHHbsSh6p6keY4fxRB9ZBJe0sFfwg'
)

void (async () => {
  const MARCAS_BORRAR = ['Erreesse', 'LX']

  for (const marca of MARCAS_BORRAR) {
    const { count } = await sb
      .from('palas_candidatas')
      .select('*', { count: 'exact', head: true })
      .eq('marca_detectada', marca)
    console.log(`${marca}: ${count} candidatas encontradas`)

    const { error } = await sb
      .from('palas_candidatas')
      .delete()
      .eq('marca_detectada', marca)

    if (error) console.error(`  ❌ Error: ${error.message}`)
    else console.log(`  ✅ Borradas`)
  }
})()
