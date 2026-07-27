/**
 * scripts/match-segunda-mano.ts
 *
 * Script standalone que ejecuta el matcher de segunda mano sobre toda la
 * wallapop_cache (Wallapop + Vinted) sin volver a scraper nada.
 *
 * Corre en el pipeline local DESPUÉS del post-pipeline de tiendas, para que
 * los anuncios de la extensión de Wallapop y del scraper de Vinted tengan
 * su pala_id asignado con el catálogo ya actualizado.
 *
 * Sustituye al workflow match-wallapop.yml (que llamaba al endpoint Vercel
 * /api/cron/match-wallapop — desactivado por fallos reiterados).
 *
 * Uso manual:
 *   npx tsx scripts/match-segunda-mano.ts
 *   npx tsx scripts/match-segunda-mano.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Cargar .env.local si existe (para ejecución local)
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('❌ Faltan variables NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY')
  process.exit(1)
}

const dryRun = process.argv.includes('--dry-run')

async function main() {
  console.log('🔗 HUNTPADEL — Match Segunda Mano')
  console.log(`📅 ${new Date().toISOString()}`)
  if (dryRun) console.log('⚠️  DRY-RUN: no se escribirá en BD\n')

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  // Importar en CommonJS porque secondhand-matcher.js y sus dependencias
  // (fuzzy-matcher, embedding-matcher) son módulos CJS, no ESM.
  const { matchSecondhandCache } = require('./prices/secondhand-matcher')
  const { recalculatePriceReference } = require('./prices/pipeline')

  const result = await matchSecondhandCache(supabase, {
    dryRun,
    verbose: true,
    recalculatePriceReference,
  })

  console.log('\n✅ Match segunda mano completado:')
  console.log(`   Total procesados : ${result.total}`)
  console.log(`   Nuevos matches   : ${result.matched}`)
  console.log(`   Mantenidos       : ${result.kept}`)
  console.log(`   Nullificados     : ${result.nullified}`)
  console.log(`   Sin match        : ${result.unmatched}`)
  console.log(`   Por embedding    : ${result.porEmbedding ?? 0}`)
  console.log(`   Errores          : ${result.errors}`)
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
