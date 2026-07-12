'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)

// Rating Trustpilot (★ sobre 5) — auditado 2026-07-01
const TIENDA_TP: Record<string, number | null> = {
  padelnuestro:     4,
  padeliberico:     4.5,
  misterpadel:      5,
  padelproshop:     4.5,
  padelmarket:      4,
  padelkiwi:        4.5,
  tiendapadelpoint: 4.5,
  justpadel:        4.5,
  time2padel:       4,
  ofertasdepadel:   4,
  tiendapadel5:     4,
  zonadepadel:      4,
  padelmania:       4.5,
  virtualpadel:     4,
  keepadel:         4.5,
  pelotapadel:      4.5,
  stockpadel:       4,
  tennispoint:      3.5,
  allforpadel:      3.5,
  padelstyle:       3.5,
  originalpadel:    3,
  futurapadelshop:  3,
  padelspain:       3,
}

function tpColor(stars: number): string {
  if (stars >= 4) return '#00B67A'
  if (stars >= 3.5) return '#FFB800'
  return '#FF5F1F'
}

function TpBadge({ slug }: { slug?: string }) {
  if (!slug) return null
  const stars = TIENDA_TP[slug]
  if (stars == null) return null
  const color = tpColor(stars)
  const full = Math.floor(stars)
  const half = stars % 1 >= 0.5
  const empty = 5 - full - (half ? 1 : 0)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}>
      <span style={{ color, fontSize: 12, letterSpacing: 1, lineHeight: 1 }}>
        {'★'.repeat(full)}
        {half && <span style={{ opacity: 0.5 }}>★</span>}
        <span style={{ opacity: 0.2 }}>{'★'.repeat(empty)}</span>
      </span>
      <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 10, letterSpacing: 0.5, color, fontWeight: 700 }}>{stars}</span>
      <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 9, letterSpacing: 1, color: 'var(--faint)', textTransform: 'uppercase' }}>Trustpilot</span>
    </div>
  )
}

function TiendasSection({ palaId, precioReferencia }: { palaId: string; precioReferencia: number }) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let activo = true
    setLoading(true)
    supabase
      .from('price_snapshots')
      .select('precio, disponible, url_producto, codigo_descuento, descuento_pct, price_sources ( nombre, slug )')
      .eq('pala_id', palaId)
      .order('disponible', { ascending: false })
      .order('precio', { ascending: true })
      .limit(10)
      .then(({ data, error }) => {
        if (!activo) return
        if (error) { console.error(error); setItems([]) }
        else setItems(data ?? [])
        setLoading(false)
      })
    return () => { activo = false }
  }, [palaId])

  if (loading) {
    return <div style={{ color: 'var(--muted)', fontSize: 13, fontFamily: "'Barlow', sans-serif" }}>Buscando mejores precios...</div>
  }
  if (items.length === 0) {
    return <div style={{ color: 'var(--muted)', fontSize: 13, fontFamily: "'Barlow', sans-serif" }}>Sin datos de tienda disponibles ahora mismo.</div>
  }

  const precioEfectivo = (item: any) => {
    const base = Number(item.precio)
    if (item.descuento_pct && Number(item.descuento_pct) > 0) {
      return base * (1 - Number(item.descuento_pct) / 100)
    }
    return base
  }

  const porTienda = new Map<string, any>()
  for (const item of items) {
    const fuente = Array.isArray(item.price_sources) ? item.price_sources[0] : item.price_sources
    const key = fuente?.slug ?? 'desconocida'
    if (!porTienda.has(key) || precioEfectivo(item) < precioEfectivo(porTienda.get(key))) {
      porTienda.set(key, item)
    }
  }
  const deduped = Array.from(porTienda.values())
    .sort((a, b) => precioEfectivo(a) - precioEfectivo(b))
    .slice(0, 3)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
      {deduped.map((item: any, i: number) => {
        const fuente = Array.isArray(item.price_sources) ? item.price_sources[0] : item.price_sources
        const precioBase = Number(item.precio)
        const pEfectivo = precioEfectivo(item)
        const tieneDescuento = pEfectivo < precioBase
        const disponible = item.disponible
        const saving = disponible && precioReferencia > 0
          ? Math.round(((precioReferencia - pEfectivo) / precioReferencia) * 100)
          : 0
        return (
          <a key={`${fuente?.slug ?? 'tienda'}-${i}`} href={item.url_producto} target="_blank" rel="noopener noreferrer"
            style={{ background: 'var(--card)', border: `1px solid ${disponible ? 'var(--border)' : 'rgba(0,0,0,0.04)'}`, borderRadius: 8, padding: '12px', textDecoration: 'none', color: 'inherit', display: 'block', transition: 'border-color 0.2s, box-shadow 0.2s', opacity: disponible ? 1 : 0.55, boxShadow: 'var(--card-shadow)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(80,120,0,0.3)'; e.currentTarget.style.boxShadow = 'var(--card-shadow-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = disponible ? 'var(--border)' : 'rgba(0,0,0,0.04)'; e.currentTarget.style.boxShadow = 'var(--card-shadow)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: disponible ? 'var(--accent-fg)' : 'var(--faint)' }}>{pEfectivo.toFixed(2)} €</span>
              {!disponible
                ? <span style={{ color: 'var(--muted)', fontFamily: "'Space Grotesk', sans-serif", fontSize: 10, letterSpacing: 1 }}>SIN STOCK</span>
                : saving > 0
                  ? <span style={{ background: 'var(--accent-dim)', color: 'var(--accent-fg)', fontFamily: "'Space Grotesk', sans-serif", fontSize: 11, letterSpacing: 1, padding: '2px 6px', borderRadius: 4 }}>-{saving}%</span>
                  : null
              }
            </div>
            {tieneDescuento && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontFamily: "'Barlow', sans-serif", fontSize: 11, color: 'var(--faint)', textDecoration: 'line-through' }}>{precioBase.toFixed(2)} €</span>
                {item.codigo_descuento && (
                  <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 10, letterSpacing: 1, color: 'var(--accent-fg)', background: 'var(--accent-dim)', padding: '1px 5px', border: '1px solid rgba(80,120,0,0.2)', borderRadius: 3 }}>{item.codigo_descuento}</span>
                )}
              </div>
            )}
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: "'Barlow', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fuente?.nombre ?? '?'}</div>
              <TpBadge slug={fuente?.slug} />
            </div>
          </a>
        )
      })}
    </div>
  )
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function precioEfectivo(row: any): number {
  const p = Number(row.precio)
  if (row.codigo_descuento && row.descuento_pct && Number(row.descuento_pct) > 0) {
    return p * (1 - Number(row.descuento_pct) / 100)
  }
  return p
}

function mediana(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

function PriceHistorySection({ palaId }: { palaId: string }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    const since = new Date(Math.max(
      Date.now() - 60 * 24 * 60 * 60 * 1000,
      new Date('2026-07-01').getTime()
    )).toISOString()
    supabase
      .from('price_history_log')
      .select('scraped_at, dia_scraped, precio, codigo_descuento, descuento_pct, url_producto, disponible, source_id, price_sources(slug, nombre)')
      .eq('pala_id', palaId)
      .eq('disponible', true)
      .neq('source_id', 2)
      .gte('scraped_at', since)
      .order('scraped_at', { ascending: true })
      .limit(3000)
      .then(({ data, error }) => {
        if (!active) return
        if (!error) setRows(data ?? [])
        setLoading(false)
      })
    return () => { active = false }
  }, [palaId])

  if (loading) return (
    <div style={{ color: 'var(--muted)', fontSize: 13, fontFamily: "'Barlow', sans-serif", padding: '16px 0' }}>
      Cargando historial...
    </div>
  )
  if (rows.length === 0) return (
    <div style={{ color: 'var(--muted)', fontSize: 13, fontFamily: "'Barlow', sans-serif" }}>Sin historial disponible.</div>
  )

  let minRow: { precio: number; nombre: string; url: string; codigo: string | null } | null = null
  let minLastFecha = ''
  let minLastDay   = ''

  for (const row of rows) {
    const p   = precioEfectivo(row)
    const src = Array.isArray(row.price_sources) ? row.price_sources[0] : row.price_sources
    const d   = new Date(row.scraped_at)
    const fecha = `${d.getDate()} ${MESES[d.getMonth()]}`
    const day   = (row as any).dia_scraped ?? row.scraped_at.slice(0, 10)

    if (!minRow || p < minRow.precio) {
      minRow = { precio: p, nombre: src?.nombre ?? '', url: row.url_producto,
        codigo: row.codigo_descuento ?? null }
      minLastFecha = fecha
      minLastDay   = day
    } else if (p === minRow.precio) {
      // misma cifra mínima en fecha posterior → actualizar "ltima vez a ese precio"
      minLastFecha = fecha
      minLastDay   = day
    }
  }

  const byDay = new Map<string, number[]>()
  for (const row of rows) {
    const day = (row as any).dia_scraped ?? row.scraped_at.slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day)!.push(Number(row.precio))
  }
  const pvpPoints = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, prices]) => ({
      ts: new Date(day).getTime(),
      precio: prices.reduce((a, b) => a + b, 0) / prices.length
    }))

  if (pvpPoints.length === 0) return null

  const W = 580, H = 200
  const PAD = { top: 16, right: 20, bottom: 30, left: 54 }
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom

  const allPrices = [...pvpPoints.map(p => p.precio), minRow!.precio]
  const rawMin = Math.min(...allPrices)
  const rawMax = Math.max(...allPrices)
  const pRange = rawMax - rawMin || 10
  const pMin = rawMin - pRange * 0.12
  const pMax = rawMax + pRange * 0.20

  const minTs = pvpPoints[0].ts
  const maxTs = pvpPoints[pvpPoints.length - 1].ts
  const tsRange = maxTs - minTs || 1

  const toX = (ts: number) => PAD.left + ((ts - minTs) / tsRange) * cW
  const toY = (p: number) => PAD.top + (1 - (p - pMin) / (pMax - pMin)) * cH

  const pvpPath = pvpPoints.map((pt, i) =>
    `${i === 0 ? 'M' : 'L'} ${toX(pt.ts).toFixed(1)},${toY(pt.precio).toFixed(1)}`
  ).join(' ')

  const yTicks = [0, 1, 2, 3].map(i => pMin + (i / 3) * (pMax - pMin))
  const numXT = Math.min(5, pvpPoints.length)
  const xTicks = numXT <= 1
    ? [pvpPoints[0]]
    : Array.from({ length: numXT }, (_, i) =>
        pvpPoints[Math.round(i / (numXT - 1) * (pvpPoints.length - 1))])

  const minY    = Math.max(toY(minRow!.precio), PAD.top + 2)
  const minDotX = Math.min(toX(new Date(minLastDay).getTime()), W - PAD.right)
  const lblAbove = minY > PAD.top + cH - 30

  return (
    <div>
      <a href={minRow!.url} target="_blank" rel="noopener noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 14,
          padding: '8px 16px', background: 'var(--accent-dim)',
          border: '1px solid rgba(80,120,0,0.2)', textDecoration: 'none', borderRadius: 8 }}>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 10, letterSpacing: 2,
          color: 'var(--muted)', textTransform: 'uppercase' }}>Minimo historico</span>
        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: 'var(--accent-fg)', lineHeight: 1 }}>
          {minRow!.precio.toFixed(2)}€
        </span>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, color: 'var(--muted)' }}>
          en {minRow!.nombre} · {minLastFecha}
          {minRow!.codigo && (
            <span style={{ marginLeft: 8, background: 'rgba(80,120,0,0.12)', color: 'var(--accent-fg)',
              fontSize: 10, letterSpacing: 1, padding: '2px 6px', fontWeight: 700, borderRadius: 3 }}>
              {minRow!.codigo}
            </span>
          )}
        </span>
        <span style={{ fontSize: 11, color: 'var(--accent-fg)' }}>&#8599;</span>
      </a>

      <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
          <rect x={PAD.left} y={PAD.top} width={cW} height={cH} fill="rgba(0,0,0,0.025)" />
          <clipPath id="hchart-clip-det">
            <rect x={PAD.left} y={PAD.top} width={cW} height={cH} />
          </clipPath>
          {yTicks.map((tick, i) => (
            <line key={i}
              x1={PAD.left} x2={W - PAD.right}
              y1={toY(tick).toFixed(1)} y2={toY(tick).toFixed(1)}
              stroke="rgba(0,0,0,0.07)" strokeWidth="1" />
          ))}
          {yTicks.map((tick, i) => (
            <text key={i}
              x={PAD.left - 7} y={(toY(tick) + 4).toFixed(1)}
              textAnchor="end" fill="rgba(0,0,0,0.42)"
              fontSize="10" fontFamily="Space Grotesk, sans-serif">
              {tick.toFixed(0)}€
            </text>
          ))}
          {xTicks.map((pt, i) => {
            const d = new Date(pt.ts)
            const lbl = `${d.getDate()} ${MESES[d.getMonth()]}`
            const x = toX(pt.ts)
            return (
              <text key={i}
                x={x.toFixed(1)} y={H - 8}
                textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
                fill="rgba(0,0,0,0.35)" fontSize="9" fontFamily="Space Grotesk, sans-serif">
                {lbl}
              </text>
            )
          })}
          <line
            x1={PAD.left} x2={minDotX.toFixed(1)}
            y1={minY.toFixed(1)} y2={minY.toFixed(1)}
            stroke="#4E7400" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.65"
            clipPath="url(#hchart-clip-det)" />
          <text
            x={(PAD.left + 6).toFixed(1)}
            y={lblAbove ? (minY - 5).toFixed(1) : (minY + 13).toFixed(1)}
            fill="#4E7400" fontSize="9.5" fontFamily="Space Grotesk, sans-serif" opacity="0.85">
            Minimo · {minRow!.precio.toFixed(2)}€ · {minRow!.nombre} · {minLastFecha}
          </text>
          {pvpPoints.length >= 2 && (
            <path d={pvpPath} fill="none" stroke="#60A5FA" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" clipPath="url(#hchart-clip-det)" />
          )}
          {pvpPoints.map((pt, i) => (
            <circle key={i}
              cx={toX(pt.ts).toFixed(1)} cy={toY(pt.precio).toFixed(1)}
              r="3" fill="#60A5FA" clipPath="url(#hchart-clip-det)" />
          ))}
          <circle cx={minDotX.toFixed(1)} cy={minY.toFixed(1)}
            r="5.5" fill="#F3F4F7" stroke="#4E7400" strokeWidth="2" />
          <circle cx={minDotX.toFixed(1)} cy={minY.toFixed(1)}
            r="2.5" fill="#4E7400" />
        </svg>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 22, height: 3, background: '#60A5FA', borderRadius: 2 }} />
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, color: 'var(--muted)' }}>Precio medio diario tiendas</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width="22" height="3"><line x1="0" y1="1.5" x2="22" y2="1.5" stroke="#4E7400" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.7" /></svg>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, color: 'var(--muted)' }}>Minimo historico</span>
        </div>
      </div>
    </div>
  )
}

export default function PalaDetalleDynamic({ palaId, precioReferencia }: { palaId: string; precioReferencia: number }) {
  return (
    <>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.5rem', marginTop: '1.5rem' }}>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 11, letterSpacing: 3, color: 'var(--muted)', marginBottom: 12, textTransform: 'uppercase' }}>Mejores precios en tienda</div>
        <TiendasSection palaId={palaId} precioReferencia={precioReferencia} />
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.5rem', marginTop: '1.5rem' }}>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 11, letterSpacing: 3, color: 'var(--muted)', marginBottom: 14, textTransform: 'uppercase' }}>Historico de precios · ultimos 60 dias</div>
        <PriceHistorySection palaId={palaId} />
      </div>
    </>
  )
}
