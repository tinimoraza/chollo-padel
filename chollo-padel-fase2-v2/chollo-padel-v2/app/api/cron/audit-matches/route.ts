/**
 * app/api/cron/audit-matches/route.ts
 * GET /api/cron/audit-matches
 *
 * Sistema de auditoría automática de matches.
 * Verifica que los items en TOP y CHOLLOS tienen matches correctos.
 *
 * Checks que realiza:
 *
 *  TOP (wallapop_cache con pala_id):
 *   M1_YEAR_MISMATCH     — título dice año X, catálogo tiene año Y  → bad match
 *   M2_LOW_COVERAGE      — <40% de tokens del modelo en el título   → bad match
 *   M3_EXCLUDED_WORD     — título tiene "pickleball"/accesorios     → debería excluirse
 *   M4_IMPOSSIBLE_DISC   — descuento >90% sobre referencia          → referencia corrupta
 *   M5_BRAND_MISMATCH    — marca del título ≠ marca del catálogo    → bad match claro
 *
 *  CHOLLOS (price_snapshots recientes):
 *   C1_URL_YEAR_MISMATCH — año en URL ≠ año catálogo               → bad match
 *   C2_EXCLUDED_WORD     — título con pickleball/accesorios         → debería excluirse
 *   C3_HIGH_DISCOUNT     — descuento >80%                           → referencia sospechosa
 *   C4_LOW_URL_COVERAGE  — tokens del modelo ausentes en URL slug   → posible bad match
 *
 * Auto-correcciones aplicadas:
 *   M1, M3, M5 → wallapop_cache: pala_id = NULL, match_method = 'audit_reset'
 *   C1, C2     → price_snapshots: disponible = false
 *               + price_match_cache: eliminar entrada de esa URL
 *
 * Resultados guardados en: match_audit_log (ver SQL de creación en scripts/migrations/)
 *
 * Autenticación: Bearer CRON_SECRET
 * Schedule: "30 * * * *" (30 min después del match-wallapop) o manualmente
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ─── Tokenizador inline (igual que match-pala-id.ts v16) ─────────────────────
// Duplicado aquí para no tener dependencia circular en el import del cron.

const STOP_WORDS = new Set([
  'de', 'da', 'del', 'la', 'el', 'y', 'e', 'con', 'para', 'pala', 'padel',
  'raqueta', 'serie', 'series', 'edition', 'version', 'by',
  'a22', 'a23', 'a24', 'rc',
])

const KEEP_WORDS = new Set([
  'hrd', 'ctrl', 'soft', 'air', 'light', 'team', 'carbon',
  'match', 'drive', 'arrow', 'cross', 'hit', 'rx',
  '18k', '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena', 'hard',
  'pro', 'evo', 'plus', 'motion', 'elite', 'genius', 'attack',
  'lite', 'x', 'proplus', 'woman', 'sft',
  'black', 'blue', 'grey', 'white', 'red', 'green', 'orange', 'pink',
  'yellow', 'purple', 'gold', 'silver', 'navy', 'lime',
])

const EXCLUIR_ACCESORIOS = new Set([
  'bolsa', 'mochila', 'funda', 'paletero', 'grip', 'overgrip',
  'protector', 'muñequera', 'bolas', 'pelota', 'pelotas', 'camiseta',
  'zapatilla', 'zapatillas', 'ropa', 'lote', 'antivibrador',
  'pickleball', 'tenis head', 'tenis wilson',
  'pure drive', 'pure aero', 'pure strike',
  'driver golf', 'speedback',
])

function tokenizar(texto: string): string[] {
  return texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/hrd\+/g, 'hrd')
    .replace(/\bhard\b/g, 'hrd')
    .replace(/\bsoft\b/g, 'sft')
    .replace(/\bctr\b/g, 'ctrl')
    .replace(/\bcontrol\b/g, 'ctrl')
    .replace(/pro\s*\+/g, 'proplus')
    .replace(/\bpro plus\b/g, 'proplus')
    .replace(/\bw\b(?=\s|$)/g, 'woman')
    .replace(/\bproline\b/g, 'line')
    .replace(/\bpro\s+line\b/g, 'line')
    .replace(/\b(hack|vertex|flow)\s+(\d)\b/g, '$1 0$2')
    .replace(/\b(\d+)\.(\d+)\b/g, 'v$1p$2')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 || t === 'x' || /^\d$/.test(t))
    .filter(t =>
      KEEP_WORDS.has(t) ||
      (!STOP_WORDS.has(t) && (!/^\d+$/.test(t) || /^0[1-9]$/.test(t) || /^\d$/.test(t) || /^v\d+p\d+$/.test(t)))
    )
}

function extraerAnio(texto: string): number | null {
  const m = texto.match(/\b(20(1[89]|2[0-9]))\b/)
  return m ? parseInt(m[1]) : null
}

function extraerTokensModelo(modelo: string, marca: string): string[] {
  const sinMarca = modelo.replace(new RegExp(`^${marca}\\s+`, 'i'), '')
  const sinAnio  = sinMarca.replace(/\b20\d{2}\b/, '').trim()
  return tokenizar(sinAnio)
}

function extraerAnioDeUrl(url: string): number | null {
  const m4 = url.match(/20(\d{2})/)
  if (m4) {
    const y = parseInt(m4[0])
    if (y >= 2018 && y <= 2030) return y
  }
  const m2 = url.match(/[_-](2[0-9])[_-](?!\d{3,})/)
  if (m2) {
    const y = 2000 + parseInt(m2[1])
    if (y >= 2018 && y <= 2030) return y
  }
  return null
}

function tituloTieneAccesorio(titulo: string): string | null {
  const t = titulo.toLowerCase()
  for (const word of Array.from(EXCLUIR_ACCESORIOS)) {
    if (t.includes(word)) return word
  }
  return null
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface AuditEntry {
  source:          'top' | 'chollos'
  severity:        'error' | 'warning'
  check_code:      string
  external_id?:    string
  pala_id?:        string
  pala_modelo?:    string
  titulo:          string
  descripcion:     string
  auto_corregido:  boolean
}

// ─── Handler principal ────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // PAUSADO — nueva estrategia de matching en desarrollo
  // TODO: reactivar cuando el nuevo sistema esté listo
  return NextResponse.json({ ok: false, message: 'PAUSADO — sistema en mantenimiento' }, { status: 503 })


  const checkedAt = new Date().toISOString()
  console.log('[audit-matches] Iniciando auditoría...', checkedAt)

  const logs: AuditEntry[] = []
  let topAudited = 0, chollosAudited = 0

  // ═══════════════════════════════════════════════════════════════════════════
  // ── A. AUDITAR TOP ────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  const { data: topItems } = await supabaseAdmin
    .from('top_oportunidades')
    .select('external_id, title, price, precio_medio, descuento_pct, pala_id, keyword')
    .order('posicion', { ascending: true })

  if (topItems && topItems.length > 0) {
    // Cargar palas del catálogo para estos pala_ids
    const palaIds = Array.from(new Set(topItems.map(i => i.pala_id).filter(Boolean)))
    const { data: palas } = await supabaseAdmin
      .from('palas')
      .select('id, marca, modelo, año')
      .in('id', palaIds) as unknown as { data: { id: string; marca: string; modelo: string; año: number }[] | null }

    const palasMap = new Map((palas ?? []).map(p => [p.id, p]))

    // Cargar precios de referencia
    const { data: refs } = await supabaseAdmin
      .from('price_reference')
      .select('pala_id, precio_referencia, fuentes_count')
      .in('pala_id', palaIds)
    const refsMap = new Map((refs ?? []).map(r => [r.pala_id, r]))

    for (const item of topItems) {
      if (!item.pala_id) continue
      topAudited++

      const pala = palasMap.get(item.pala_id)
      if (!pala) continue

      const modeloTokens = extraerTokensModelo(pala.modelo, pala.marca)
      const tituloTokens = tokenizar(item.title)
      const anioTitulo   = extraerAnio(item.title)
      const ref          = refsMap.get(item.pala_id)

      // ── M1: Year mismatch ─────────────────────────────────────────────────
      if (anioTitulo !== null && pala.año && anioTitulo !== pala.año) {
        const entry: AuditEntry = {
          source:         'top',
          severity:       'error',
          check_code:     'M1_YEAR_MISMATCH',
          external_id:    item.external_id,
          pala_id:        item.pala_id,
          pala_modelo:    pala.modelo,
          titulo:         item.title,
          descripcion:    `Año del título (${anioTitulo}) ≠ año del catálogo (${pala.año}). Match incorrecto.`,
          auto_corregido: false,
        }

        // Auto-corrección: resetear pala_id en wallapop_cache para que se rematchee
        const { error: resetErr } = await supabaseAdmin
          .from('wallapop_cache')
          .update({ pala_id: null, match_method: 'audit_reset' })
          .eq('external_id', item.external_id)
          .is('match_method', null)  // solo si no fue reseteado ya

        // Intentar también con match_method = 'fuzzy_auto' (los que sí fueron matcheados)
        await supabaseAdmin
          .from('wallapop_cache')
          .update({ pala_id: null, match_method: 'audit_reset' })
          .eq('external_id', item.external_id)
          .eq('match_method', 'fuzzy_auto')

        if (!resetErr) entry.auto_corregido = true
        logs.push(entry)
      }

      // ── M2: Low token coverage ────────────────────────────────────────────
      if (modeloTokens.length > 2) {
        const matchedTokens = modeloTokens.filter(t => tituloTokens.includes(t))
        const coverage = matchedTokens.length / modeloTokens.length

        if (coverage < 0.40) {
          logs.push({
            source:         'top',
            severity:       'warning',
            check_code:     'M2_LOW_COVERAGE',
            external_id:    item.external_id,
            pala_id:        item.pala_id,
            pala_modelo:    pala.modelo,
            titulo:         item.title,
            descripcion:    `Solo ${Math.round(coverage * 100)}% de los tokens del modelo "${pala.modelo}" aparecen en el título. Tokens esperados: [${modeloTokens.join(', ')}]. Encontrados: [${matchedTokens.join(', ')}].`,
            auto_corregido: false,
          })
        }
      }

      // ── M3: Excluded word in title ────────────────────────────────────────
      const accesorioEncontrado = tituloTieneAccesorio(item.title)
      if (accesorioEncontrado) {
        const entry: AuditEntry = {
          source:         'top',
          severity:       'error',
          check_code:     'M3_EXCLUDED_WORD',
          external_id:    item.external_id,
          pala_id:        item.pala_id,
          pala_modelo:    pala.modelo,
          titulo:         item.title,
          descripcion:    `Título contiene palabra excluida: "${accesorioEncontrado}". Este item no debería estar en el TOP.`,
          auto_corregido: false,
        }

        // Auto-corrección: resetear pala_id para sacarlo del TOP en el próximo run
        await supabaseAdmin
          .from('wallapop_cache')
          .update({ pala_id: null, match_method: 'audit_reset' })
          .eq('external_id', item.external_id)

        entry.auto_corregido = true
        logs.push(entry)
      }

      // ── M4: Impossible discount ───────────────────────────────────────────
      if (item.descuento_pct > 90) {
        logs.push({
          source:         'top',
          severity:       'warning',
          check_code:     'M4_IMPOSSIBLE_DISCOUNT',
          external_id:    item.external_id,
          pala_id:        item.pala_id,
          pala_modelo:    pala.modelo,
          titulo:         item.title,
          descripcion:    `Descuento del ${item.descuento_pct}% sobre precio de referencia ${item.precio_medio}€. Inusualmente alto — posible referencia inflada o match incorrecto.`,
          auto_corregido: false,
        })
      }

      // ── M5: Brand mismatch ────────────────────────────────────────────────
      const marcaNorm = pala.marca.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      const tituloNorm = item.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      // Comprobar que la marca del catálogo aparece en el título (o un alias conocido)
      const ALIAS_MARCAS: Record<string, string[]> = {
        'star vie': ['starvie', 'star vie'],
        'black crown': ['blackcrown', 'black crown'],
        'drop shot': ['dropshot', 'drop shot'],
        'royal padel': ['royal padel'],
        'vibora': ['vibor-a', 'vibora'],
      }
      const aliasesMarca = ALIAS_MARCAS[marcaNorm] ?? [marcaNorm]
      const marcaEnTitulo = aliasesMarca.some(a => tituloNorm.includes(a))

      if (!marcaEnTitulo && !tituloNorm.includes(marcaNorm.split(' ')[0])) {
        logs.push({
          source:         'top',
          severity:       'warning',
          check_code:     'M5_BRAND_MISMATCH',
          external_id:    item.external_id,
          pala_id:        item.pala_id,
          pala_modelo:    pala.modelo,
          titulo:         item.title,
          descripcion:    `Marca del catálogo "${pala.marca}" no aparece en el título. Posible match incorrecto por alias de modelo (ej: "Vertex" → Bullpadel, "AT10" → Nox). Verificar manualmente.`,
          auto_corregido: false,
        })
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── B. AUDITAR CHOLLOS ────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: snapshots } = await supabaseAdmin
    .from('price_snapshots')
    .select('id, pala_id, precio, url_producto, scraped_at, source_id, match_confidence')
    .eq('disponible', true)
    .gte('scraped_at', since24h)
    .gte('match_confidence', 0.92)
    .neq('source_id', 2)   // excluir PadelZoom

  if (snapshots && snapshots.length > 0) {
    const palasIdsChollos = Array.from(new Set(snapshots.map(s => s.pala_id).filter(Boolean)))
    const { data: palasChollos } = await supabaseAdmin
      .from('palas')
      .select('id, marca, modelo, año, precio_referencia')
      .in('id', palasIdsChollos) as unknown as { data: { id: string; marca: string; modelo: string; año: number; precio_referencia: number }[] | null }
    const palasCholosMap = new Map((palasChollos ?? []).map(p => [p.id, p]))

    // Cargar cache de matches para estos snapshots
    const { data: cacheEntries } = await supabaseAdmin
      .from('price_match_cache')
      .select('source_id, producto_url, producto_titulo, pala_id')
      .in('producto_url', snapshots.map(s => s.url_producto))

    const cacheMap = new Map((cacheEntries ?? []).map(c => [
      `${c.source_id}__${c.producto_url}`, c
    ]))

    for (const snap of snapshots) {
      if (!snap.pala_id) continue
      chollosAudited++

      const pala = palasCholosMap.get(snap.pala_id)
      if (!pala) continue

      const ref = pala.precio_referencia
      const url = snap.url_producto

      // ── C1: URL year mismatch ──────────────────────────────────────────────
      const urlAnio = extraerAnioDeUrl(url)
      if (urlAnio !== null && pala.año && urlAnio !== pala.año) {
        const entry: AuditEntry = {
          source:         'chollos',
          severity:       'error',
          check_code:     'C1_URL_YEAR_MISMATCH',
          pala_id:        snap.pala_id,
          pala_modelo:    pala.modelo,
          titulo:         url,
          descripcion:    `Año en URL (${urlAnio}) ≠ año catálogo (${pala.año}). URL: ${url.slice(-60)}. Snapshot marcado como no disponible.`,
          auto_corregido: false,
        }

        // Auto-corrección: marcar snapshot como no disponible
        await supabaseAdmin
          .from('price_snapshots')
          .update({ disponible: false })
          .eq('id', snap.id)

        // Invalidar caché de match para que se rematchee en el próximo scrape
        await supabaseAdmin
          .from('price_match_cache')
          .delete()
          .eq('source_id', snap.source_id)
          .eq('producto_url', url)

        entry.auto_corregido = true
        logs.push(entry)
      }

      // ── C2: Excluded word in title (via cache) ─────────────────────────────
      const cacheKey = `${snap.source_id}__${url}`
      const cacheEntry = cacheMap.get(cacheKey)
      if (cacheEntry?.producto_titulo) {
        const accesoioEnUrl = tituloTieneAccesorio(cacheEntry.producto_titulo)
        if (accesoioEnUrl) {
          const entry: AuditEntry = {
            source:         'chollos',
            severity:       'error',
            check_code:     'C2_EXCLUDED_WORD',
            pala_id:        snap.pala_id,
            pala_modelo:    pala.modelo,
            titulo:         cacheEntry.producto_titulo,
            descripcion:    `Título "${cacheEntry.producto_titulo.substring(0, 60)}" contiene palabra excluida: "${accesoioEnUrl}". Snapshot desactivado.`,
            auto_corregido: false,
          }

          await supabaseAdmin
            .from('price_snapshots')
            .update({ disponible: false })
            .eq('id', snap.id)

          await supabaseAdmin
            .from('price_match_cache')
            .delete()
            .eq('source_id', snap.source_id)
            .eq('producto_url', url)

          entry.auto_corregido = true
          logs.push(entry)
        }
      }

      // ── C3: High discount ──────────────────────────────────────────────────
      if (ref && ref > 0) {
        const descuento = Math.round(((ref - snap.precio) / ref) * 100)
        if (descuento > 80) {
          logs.push({
            source:         'chollos',
            severity:       'warning',
            check_code:     'C3_HIGH_DISCOUNT',
            pala_id:        snap.pala_id,
            pala_modelo:    pala.modelo,
            titulo:         url,
            descripcion:    `Descuento ${descuento}% (${snap.precio}€ vs referencia ${ref}€). Inusualmente alto para tienda — posible referencia inflada por match incorrecto. URL: ${url.slice(-50)}`,
            auto_corregido: false,
          })
        }
      }

      // ── C4: Low URL-model coverage ─────────────────────────────────────────
      // Comprueba que al menos 1 token del modelo aparece en el slug de la URL.
      // Si el modelo tiene tokens significativos y ninguno aparece en la URL,
      // es probable que el match sea de otro producto.
      const slug = url.split('/').filter(Boolean).pop() ?? ''
      const slugNorm = slug.toLowerCase().replace(/[-_]/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '')
      const modeloTokens = extraerTokensModelo(pala.modelo, pala.marca)
      // Solo tokens de más de 3 caracteres y que sean palabras clave del modelo
      const tokensClave = modeloTokens.filter(t => t.length >= 3 && !['pro', 'air', 'hit', 'evo'].includes(t))

      if (tokensClave.length >= 2) {
        const tokensEnSlug = tokensClave.filter(t => slugNorm.includes(t))
        const coverage = tokensEnSlug.length / tokensClave.length

        if (coverage < 0.25) {
          logs.push({
            source:         'chollos',
            severity:       'warning',
            check_code:     'C4_LOW_URL_COVERAGE',
            pala_id:        snap.pala_id,
            pala_modelo:    pala.modelo,
            titulo:         url,
            descripcion:    `Solo ${Math.round(coverage * 100)}% de tokens clave del modelo "${pala.modelo}" [${tokensClave.join(', ')}] aparecen en la URL "${slug.substring(0, 60)}". Posible match incorrecto.`,
            auto_corregido: false,
          })
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── C. GUARDAR LOGS EN BD ─────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  if (logs.length > 0) {
    const logsToInsert = logs.map(l => ({
      checked_at:     checkedAt,
      source:         l.source,
      severity:       l.severity,
      check_code:     l.check_code,
      external_id:    l.external_id ?? null,
      pala_id:        l.pala_id ?? null,
      pala_modelo:    l.pala_modelo ?? null,
      titulo:         l.titulo.substring(0, 300),
      descripcion:    l.descripcion,
      auto_corregido: l.auto_corregido,
    }))

    const { error: insertErr } = await supabaseAdmin
      .from('match_audit_log')
      .insert(logsToInsert)

    if (insertErr) {
      console.error('[audit-matches] Error guardando logs:', insertErr.message)
      // Si la tabla no existe aún, devolvemos los logs igualmente en la respuesta
    }
  }

  // Resumen por tipo
  const errors   = logs.filter(l => l.severity === 'error')
  const warnings = logs.filter(l => l.severity === 'warning')
  const autocorr = logs.filter(l => l.auto_corregido)

  const summary = {
    top_auditados:      topAudited,
    chollos_auditados:  chollosAudited,
    errores_encontrados: errors.length,
    warnings_encontrados: warnings.length,
    auto_corregidos:    autocorr.length,
    por_check: logs.reduce((acc, l) => {
      acc[l.check_code] = (acc[l.check_code] ?? 0) + 1
      return acc
    }, {} as Record<string, number>),
  }

  console.log('[audit-matches] Auditoría completada:', JSON.stringify(summary))

  return NextResponse.json({
    ok:      true,
    summary,
    logs,    // devueltos también en la respuesta para depuración manual
    checked_at: checkedAt,
  })
}

