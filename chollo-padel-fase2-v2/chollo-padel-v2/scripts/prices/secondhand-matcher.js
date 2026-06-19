// scripts/prices/secondhand-matcher.js
// ===========================================
// Motor único de matching para anuncios de segunda mano (wallapop_cache:
// Wallapop + Vinted). Sustituye a wallapop-matcher.js (Jaro-Winkler) y
// match-pala-id.ts (tokenizador propio, deshabilitado).
//
// Estrategia (aprobada 2026-06-19):
//   1. fuzzy-matcher.js  → reglas: marca exacta + año/versión + tokens
//      diferenciadores. Rápido, sin red.
//   2. embedding-matcher.js → fallback semántico solo si (1) no resuelve
//      o se queda por debajo del umbral. Tolera texto libre de particulares.
//   Umbral único: MIN_CONFIDENCE = 0.95 para asignar pala_id. Por debajo,
//   pala_id = null (se sigue mostrando en buscador, pero no contamina
//   price_reference ni aparece en chollos). Preferimos no-match a match malo.
//
// Uso (desde scrapers o cron):
//   const { matchSecondhandCache } = require('./secondhand-matcher')
//   const result = await matchSecondhandCache(supabase, { dryRun: false, verbose: false })
//   → { total, matched, nullified, kept, unmatched, errors }

const { fuzzyMatch } = require('./fuzzy-matcher')
const { embeddingMatch } = require('./embedding-matcher')

const MIN_CONFIDENCE = 0.95
const PAGE_SIZE = 1000

/**
 * Re-matchea entradas de wallapop_cache usando fuzzy + embedding fallback.
 *
 * @param {object} supabase - cliente Supabase (admin / service role)
 * @param {object} opts
 * @param {boolean} opts.dryRun - si true, no escribe en BD
 * @param {boolean} opts.verbose - si true, loguea progreso
 * @param {boolean} opts.soloSinMatch - si true, solo procesa pala_id IS NULL
 *   (nuevos de la extensión); si false (default), también reintenta los que
 *   tienen match_confidence < MIN_CONFIDENCE o NULL (para cuando el catálogo crece).
 * @param {function} opts.recalculatePriceReference - función opcional para
 *   recalcular price_reference de las palas afectadas tras escribir
 */
async function matchSecondhandCache(supabase, opts = {}) {
  const dryRun = opts.dryRun ?? false
  const verbose = opts.verbose ?? true
  const soloSinMatch = opts.soloSinMatch ?? false
  const log = (...args) => { if (verbose) console.log(...args) }

  log('🔗 matchSecondhandCache: cargando entradas...')

  let query = supabase
    .from('wallapop_cache')
    .select('external_id, title, url, platform, match_confidence, pala_id')

  if (soloSinMatch) {
    query = query.is('pala_id', null)
  } else {
    query = query.or('pala_id.is.null,match_confidence.is.null,match_confidence.lt.0.95')
  }

  const items = []
  let from = 0
  while (true) {
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error('❌ matchSecondhandCache: error cargando wallapop_cache:', error)
      return { total: 0, matched: 0, nullified: 0, kept: 0, unmatched: 0, errors: 1 }
    }
    if (!data || data.length === 0) break
    items.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  log(`📊 ${items.length} entradas a procesar`)

  const stats = { total: items.length, matched: 0, nullified: 0, kept: 0, unmatched: 0, errors: 0, porEmbedding: 0 }
  if (items.length === 0) return stats

  const palaIdsAfectadas = new Set()
  const updates = []

  for (const item of items) {
    try {
      let result = await fuzzyMatch(item.title, item.url || null)

      const fuzzyFailed = !result.pala_id || result.confidence < MIN_CONFIDENCE
      if (fuzzyFailed) {
        try {
          const embResult = await embeddingMatch(item.title)
          if (embResult.pala_id && embResult.confidence >= MIN_CONFIDENCE) {
            result = embResult
            stats.porEmbedding++
          }
        } catch (_) { /* fallback silencioso */ }
      }

      const matchBueno = result.pala_id && result.confidence >= MIN_CONFIDENCE

      if (matchBueno) {
        if (item.pala_id === result.pala_id) {
          stats.kept++
        } else {
          stats.matched++
          if (item.pala_id) palaIdsAfectadas.add(item.pala_id) // pierde el match anterior
        }
        palaIdsAfectadas.add(result.pala_id)
        updates.push({ external_id: item.external_id, pala_id: result.pala_id, match_confidence: result.confidence })
      } else {
        if (item.pala_id) {
          stats.nullified++
          palaIdsAfectadas.add(item.pala_id)
        } else {
          stats.unmatched++
        }
        updates.push({ external_id: item.external_id, pala_id: null, match_confidence: null })
      }
    } catch (err) {
      console.error(`❌ matchSecondhandCache: error en "${item.title}":`, err.message)
      stats.errors++
    }
  }

  if (!dryRun && updates.length > 0) {
    log(`💾 Escribiendo ${updates.length} updates...`)

    const nullificaciones = updates.filter(u => u.pala_id === null)
    const asignaciones = updates.filter(u => u.pala_id !== null)

    const NULL_BATCH = 500
    for (let i = 0; i < nullificaciones.length; i += NULL_BATCH) {
      const ids = nullificaciones.slice(i, i + NULL_BATCH).map(u => u.external_id)
      const { error } = await supabase
        .from('wallapop_cache')
        .update({ pala_id: null, match_confidence: null })
        .in('external_id', ids)
      if (error) console.error('❌ Error nullificando batch:', error.message)
    }

    const ASSIGN_BATCH = 50
    for (let i = 0; i < asignaciones.length; i += ASSIGN_BATCH) {
      const batch = asignaciones.slice(i, i + ASSIGN_BATCH)
      await Promise.all(batch.map(u =>
        supabase
          .from('wallapop_cache')
          .update({ pala_id: u.pala_id, match_confidence: u.match_confidence })
          .eq('external_id', u.external_id)
      ))
    }
  } else if (dryRun) {
    log(`[DRY RUN] Se habrían escrito ${updates.length} updates`)
  }

  if (typeof opts.recalculatePriceReference === 'function' && palaIdsAfectadas.size > 0 && !dryRun) {
    log(`🔁 Recalculando price_reference para ${palaIdsAfectadas.size} palas...`)
    await opts.recalculatePriceReference([...palaIdsAfectadas])
  }

  log(`✅ matchSecondhandCache completado: ${stats.matched} nuevos, ${stats.kept} confirmados, ${stats.nullified} nullificados, ${stats.unmatched} sin match, ${stats.errors} errores (${stats.porEmbedding} vía embedding)`)

  return stats
}

module.exports = { matchSecondhandCache, MIN_CONFIDENCE }
