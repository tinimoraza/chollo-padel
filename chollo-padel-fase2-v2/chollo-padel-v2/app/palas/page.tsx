'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import Header from '@/components/Header'
import BottomNav from '@/components/BottomNav'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)

// Columnas reales de la tabla palas en Supabase
interface Pala {
  id: string
  slug: string
  nombre: string
  marca: string
  brand_slug: string
  modelo: string
  año: number
  forma: string
  balance: string
  tacto: string
  juego: string
  genero: string
  peso_min: number
  peso_max: number
  material_cara: string
  material_nucleo: string
  material_marco: string
  rating_global: number
  rating_potencia: number
  rating_control: number
  rating_rebote: number
  rating_manejabilidad: number
  rating_punto_dulce: number
  precio_pvp: number
  // Media que calculamos nosotros a partir de los price_snapshots reales de
  // tiendas (ver _bd_recalcular_price_reference en GestorCandidatas) — es el
  // precio que queremos mostrar en catálogo, no el PVP de fábrica.
  precio_referencia: number
  imagen_url: string
  padelful_slug: string
}

interface Filters {
  marca: string
  forma: string
  balance: string
  juego: string
  onlyChollos: boolean
}

const FORMAS = ['Redonda', 'Diamante', 'Lágrima']
const BALANCES = ['Alto', 'Medio', 'Bajo']
const JUEGOS = ['Iniciación', 'Intermedio', 'Avanzado', 'Competición']

// Rating Trustpilot (★ sobre 5) — auditado 2026-07-01
const TIENDA_TP: Record<string, number | null> = {
  padelnuestro:    4,
  padeliberico:    4.5,
  misterpadel:     5,
  padelproshop:    4.5,
  padelmarket:     4,
  padelkiwi:       4.5,
  tiendapadelpoint:4.5,
  justpadel:       4.5,
  time2padel:      4,
  ofertasdepadel:  4,
  tiendapadel5:    4,
  zonadepadel:     4,
  padelmania:      4.5,
  virtualpadel:    4,
  keepadel:        4.5,
  pelotapadel:     4.5,   // 4.7 sobre 5 — 1.279 reseñas
  padelisland:     4.5,   // 4.8 sobre 5 — 47 reseñas
  stockpadel:      4,
  tennispoint:     3.5,
  allforpadel:     3.5,
  padelstyle:      3.5,
  originalpadel:   3,
  futurapadelshop: 3,
  padelspain:      3,
}

function tpColor(stars: number): string {
  if (stars >= 4)   return '#00B67A'
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
      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, letterSpacing: 0.5, color, fontWeight: 700 }}>{stars}</span>
      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 9, letterSpacing: 1, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase' }}>Trustpilot</span>
    </div>
  )
}

function StatBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(Math.max((value / 10) * 100, 0), 100)
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: 'rgba(255,255,255,0.5)', fontFamily: "'Barlow Condensed', sans-serif", textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontSize: 11, color: '#C8FF00', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>{value?.toFixed(1)}/10</span>
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #C8FF00, #8FCC00)', borderRadius: 2, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

function Tag({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span style={{
      fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11,
      letterSpacing: 1.5, textTransform: 'uppercase',
      padding: '3px 10px',
      border: accent ? '1px solid rgba(200,255,0,0.35)' : '1px solid rgba(255,255,255,0.12)',
      color: accent ? '#C8FF00' : 'rgba(255,255,255,0.55)',
    }}>{children}</span>
  )
}

function TechRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', fontFamily: "'Barlow', sans-serif", minWidth: 64 }}>{label}:</span>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', fontFamily: "'Barlow', sans-serif" }}>{value}</span>
    </div>
  )
}

// tarea (2026-06-30): antes este bloque buscaba "chollos" de segunda mano
// (Wallapop/Vinted) por texto libre marca+modelo, lo que muchas veces no
// tenía nada que ver con la pala real. Patricia pidió que al entrar en una
// pala se vea el TOP de mejores precios reales en TIENDA (price_snapshots),
// de menor a mayor — igual que ya hacemos para decidir el precio_referencia.
function TiendasSection({ pala }: { pala: Pala }) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let activo = true
    setLoading(true)
    // Primero intentamos con disponible=true; si no hay, mostramos todas
    // las tiendas conocidas (pueden estar sin stock puntualmente).
    supabase
      .from('price_snapshots')
      .select('precio, disponible, url_producto, codigo_descuento, descuento_pct, price_sources ( nombre, slug )')
      .eq('pala_id', pala.id)
      .order('disponible', { ascending: false }) // disponibles primero
      .order('precio', { ascending: true })
      .limit(10)
      .then(({ data, error }) => {
        if (!activo) return
        if (error) { console.error(error); setItems([]) }
        else setItems(data ?? [])
        setLoading(false)
      })
    return () => { activo = false }
  }, [pala.id])

  if (loading) {
    return <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, fontFamily: "'Barlow', sans-serif" }}>Buscando mejores precios...</div>
  }
  if (items.length === 0) {
    return <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, fontFamily: "'Barlow', sans-serif" }}>Sin datos de tienda disponibles ahora mismo.</div>
  }

  // Precio efectivo aplicando código de descuento si existe
  const precioEfectivo = (item: any) => {
    const base = Number(item.precio)
    if (item.descuento_pct && Number(item.descuento_pct) > 0) {
      return base * (1 - Number(item.descuento_pct) / 100)
    }
    return base
  }

  // Deduplicar por tienda (quedarse con el más barato efectivo de cada fuente)
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
        const saving = disponible && pala.precio_referencia > 0 ? Math.round(((pala.precio_referencia - pEfectivo) / pala.precio_referencia) * 100) : 0
        return (
          <a key={`${fuente?.slug ?? 'tienda'}-${i}`} href={item.url_producto} target="_blank" rel="noopener noreferrer"
            style={{ background: '#161616', border: `1px solid ${disponible ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)'}`, padding: '12px', textDecoration: 'none', color: 'inherit', display: 'block', transition: 'border-color 0.2s', opacity: disponible ? 1 : 0.55 }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(200,255,0,0.25)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = disponible ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: disponible ? '#C8FF00' : 'rgba(255,255,255,0.35)' }}>{pEfectivo.toFixed(2)} €</span>
              {!disponible
                ? <span style={{ color: 'rgba(255,255,255,0.3)', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, letterSpacing: 1 }}>SIN STOCK</span>
                : saving > 0
                  ? <span style={{ background: 'rgba(200,255,0,0.15)', color: '#C8FF00', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, letterSpacing: 1, padding: '2px 6px' }}>-{saving}%</span>
                  : null
              }
            </div>
            {tieneDescuento && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontFamily: "'Barlow', sans-serif", fontSize: 11, color: 'rgba(255,255,255,0.3)', textDecoration: 'line-through' }}>{precioBase.toFixed(2)} €</span>
                {item.codigo_descuento && (
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, letterSpacing: 1, color: '#C8FF00', background: 'rgba(200,255,0,0.1)', padding: '1px 5px', border: '1px solid rgba(200,255,0,0.2)' }}>{item.codigo_descuento}</span>
                )}
              </div>
            )}
            <div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontFamily: "'Barlow', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fuente?.nombre ?? '?'}</div>
              <TpBadge slug={fuente?.slug} />
            </div>
          </a>
        )
      })}
    </div>
  )
}


const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

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

function PriceHistorySection({ pala }: { pala: Pala }) {
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
      .select('scraped_at, precio, codigo_descuento, descuento_pct, url_producto, disponible, price_sources(slug, nombre)')
      .eq('pala_id', pala.id)
      .eq('disponible', true)
      .gte('scraped_at', since)
      .order('scraped_at', { ascending: true })
      .limit(800)
      .then(({ data, error }) => {
        if (!active) return
        if (!error) setRows(data ?? [])
        setLoading(false)
      })
    return () => { active = false }
  }, [pala.id])

  if (loading) return (
    <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, fontFamily: "'Barlow', sans-serif", padding: '16px 0' }}>
      Cargando historial...
    </div>
  )

  if (rows.length === 0) return (
    <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, fontFamily: "'Barlow', sans-serif" }}>Sin historial disponible.</div>
  )

  // ── Mínimo histórico (precio efectivo con código de descuento si lo hay) ─────
  let minRow: { precio: number; nombre: string; url: string; fecha: string; codigo: string | null } | null = null
  for (const row of rows) {
    const p = precioEfectivo(row)
    if (!minRow || p < minRow.precio) {
      const src = Array.isArray(row.price_sources) ? row.price_sources[0] : row.price_sources
      const d = new Date(row.scraped_at)
      minRow = { precio: p, nombre: src?.nombre ?? '', url: row.url_producto,
        fecha: `${d.getDate()} ${MESES[d.getMonth()]}`, codigo: row.codigo_descuento ?? null }
    }
  }

  // ── PVP medio diario (mediana de precios efectivos por día) ─────────────────
  const byDay = new Map<string, number[]>()
  for (const row of rows) {
    const day = row.scraped_at.slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day)!.push(precioEfectivo(row))
  }
  const pvpPoints = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, prices]) => ({ ts: new Date(day).getTime(), precio: mediana(prices) }))

  if (pvpPoints.length === 0) return null

  // ── Dimensiones SVG ─────────────────────────────────────────────────────────
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
  const toY = (p: number)  => PAD.top  + (1 - (p - pMin) / (pMax - pMin)) * cH

  // ── Path PVP ────────────────────────────────────────────────────────────────
  const pvpPath = pvpPoints.map((pt, i) =>
    `${i === 0 ? 'M' : 'L'} ${toX(pt.ts).toFixed(1)},${toY(pt.precio).toFixed(1)}`
  ).join(' ')

  // ── Y ticks ─────────────────────────────────────────────────────────────────
  const yTicks = [0, 1, 2, 3].map(i => pMin + (i / 3) * (pMax - pMin))

  // ── X ticks (hasta 5, distribuidos uniformemente) ───────────────────────────
  const numXT = Math.min(5, pvpPoints.length)
  const xTicks = numXT <= 1
    ? [pvpPoints[0]]
    : Array.from({ length: numXT }, (_, i) =>
        pvpPoints[Math.round(i / (numXT - 1) * (pvpPoints.length - 1))])

  // ── Posición Y del mínimo histórico ─────────────────────────────────────────
  const minY = Math.max(toY(minRow!.precio), PAD.top + 2)
  // La etiqueta del mínimo: si está muy abajo, ponerla arriba del marcador
  const lblAbove = minY > PAD.top + cH - 30

  return (
    <div>
      {/* Badge mínimo histórico */}
      <a href={minRow!.url} target="_blank" rel="noopener noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 14,
          padding: '8px 16px', background: 'rgba(200,255,0,0.04)',
          border: '1px solid rgba(200,255,0,0.18)', textDecoration: 'none' }}>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, letterSpacing: 2,
          color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Mínimo histórico</span>
        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: '#C8FF00', lineHeight: 1 }}>
          {minRow!.precio.toFixed(2)}€
        </span>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
          en {minRow!.nombre} · {minRow!.fecha}
          {minRow!.codigo && (
            <span style={{ marginLeft: 8, background: 'rgba(200,255,0,0.15)', color: '#C8FF00',
              fontSize: 10, letterSpacing: 1, padding: '2px 6px', fontWeight: 700 }}>
              {minRow!.codigo}
            </span>
          )}
        </span>
        <span style={{ fontSize: 11, color: 'rgba(200,255,0,0.6)' }}>↗</span>
      </a>

      {/* Gráfico SVG */}
      <div style={{ background: '#16191e', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>

          {/* Fondo área */}
          <rect x={PAD.left} y={PAD.top} width={cW} height={cH} fill="#1c2330" />

          {/* Clip */}
          <clipPath id="hchart-clip">
            <rect x={PAD.left} y={PAD.top} width={cW} height={cH} />
          </clipPath>

          {/* Grid horizontal */}
          {yTicks.map((tick, i) => (
            <line key={i}
              x1={PAD.left} x2={W - PAD.right}
              y1={toY(tick).toFixed(1)} y2={toY(tick).toFixed(1)}
              stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          ))}

          {/* Y labels */}
          {yTicks.map((tick, i) => (
            <text key={i}
              x={PAD.left - 7} y={(toY(tick) + 4).toFixed(1)}
              textAnchor="end" fill="rgba(255,255,255,0.4)"
              fontSize="10" fontFamily="Barlow Condensed, sans-serif">
              {tick.toFixed(0)}€
            </text>
          ))}

          {/* X labels */}
          {xTicks.map((pt, i) => {
            const d = new Date(pt.ts)
            const lbl = `${d.getDate()} ${MESES[d.getMonth()]}`
            const x = toX(pt.ts)
            return (
              <text key={i}
                x={x.toFixed(1)} y={H - 8}
                textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
                fill="rgba(255,255,255,0.32)" fontSize="9" fontFamily="Barlow Condensed, sans-serif">
                {lbl}
              </text>
            )
          })}

          {/* Línea mínimo histórico (horizontal punteada) */}
          <line
            x1={PAD.left} x2={W - PAD.right}
            y1={minY.toFixed(1)} y2={minY.toFixed(1)}
            stroke="#C8FF00" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.55"
            clipPath="url(#hchart-clip)" />

          {/* Etiqueta inline mínimo */}
          <text
            x={(PAD.left + 6).toFixed(1)}
            y={lblAbove ? (minY - 5).toFixed(1) : (minY + 13).toFixed(1)}
            fill="#C8FF00" fontSize="9.5" fontFamily="Barlow Condensed, sans-serif" opacity="0.8">
            Mínimo · {minRow!.precio.toFixed(2)}€ · {minRow!.nombre} · {minRow!.fecha}
          </text>

          {/* Línea PVP medio */}
          {pvpPoints.length >= 2 && (
            <path d={pvpPath} fill="none" stroke="#60A5FA" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" clipPath="url(#hchart-clip)" />
          )}

          {/* Puntos PVP */}
          {pvpPoints.map((pt, i) => (
            <circle key={i}
              cx={toX(pt.ts).toFixed(1)} cy={toY(pt.precio).toFixed(1)}
              r="3" fill="#60A5FA" clipPath="url(#hchart-clip)" />
          ))}

          {/* Marcador del mínimo */}
          <circle cx={(W - PAD.right).toFixed(1)} cy={minY.toFixed(1)}
            r="5.5" fill="#1c2330" stroke="#C8FF00" strokeWidth="2" />
          <circle cx={(W - PAD.right).toFixed(1)} cy={minY.toFixed(1)}
            r="2.5" fill="#C8FF00" />

        </svg>
      </div>

      {/* Leyenda */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 22, height: 3, background: '#60A5FA', borderRadius: 2 }} />
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12,
            color: 'rgba(255,255,255,0.55)' }}>PVP medio (mediana tiendas)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width="22" height="3"><line x1="0" y1="1.5" x2="22" y2="1.5" stroke="#C8FF00" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.7"/></svg>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12,
            color: 'rgba(255,255,255,0.55)' }}>Mínimo histórico</span>
        </div>
      </div>
    </div>
  )
}

function PalaModal({ pala, onClose }: { pala: Pala; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backdropFilter: 'blur(4px)' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#111', border: '1px solid rgba(200,255,0,0.15)', width: '100%', maxWidth: 760, maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)', width: 32, height: 32, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>✕</button>

        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 0 }}>
          <div style={{ background: '#cfcfcd', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', borderRight: '1px solid rgba(255,255,255,0.07)' }}>
            {pala.imagen_url
              ? <img src={pala.imagen_url} alt={pala.nombre} style={{ maxWidth: '100%', maxHeight: 280, objectFit: 'contain', mixBlendMode: 'multiply' }} />
              : <div style={{ fontSize: 64 }}>🏓</div>
            }
          </div>

          <div style={{ padding: '2rem' }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, letterSpacing: 3, color: '#C8FF00', marginBottom: 6, textTransform: 'uppercase' }}>{pala.marca}</div>
            <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 2, marginBottom: 12, lineHeight: 1.1 }}>{pala.nombre}</h2>

            {pala.precio_referencia > 0 ? (
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: '#C8FF00', marginBottom: 16 }}>
                {pala.precio_referencia.toFixed(2)} €
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: "'Barlow', sans-serif", marginLeft: 6 }}>precio medio tiendas</span>
              </div>
            ) : pala.precio_pvp > 0 ? (
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: '#C8FF00', marginBottom: 16 }}>
                {pala.precio_pvp.toFixed(2)} €
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: "'Barlow', sans-serif", marginLeft: 6 }}>PVP</span>
              </div>
            ) : null}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
              {pala.forma && <Tag>{pala.forma}</Tag>}
              {pala.balance && <Tag>{pala.balance}</Tag>}
              {pala.juego && <Tag accent>{pala.juego}</Tag>}
              {pala.genero && pala.genero !== 'Unisex' && <Tag>{pala.genero}</Tag>}
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 16, marginBottom: 16 }}>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, letterSpacing: 2, color: 'rgba(255,255,255,0.35)', marginBottom: 10, textTransform: 'uppercase' }}>Características técnicas</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                {pala.material_nucleo && <TechRow label="Núcleo" value={pala.material_nucleo} />}
                {pala.material_cara && <TechRow label="Cara" value={pala.material_cara} />}
                {pala.material_marco && <TechRow label="Marco" value={pala.material_marco} />}
                {(pala.peso_min || pala.peso_max) && (
                  <TechRow label="Peso" value={pala.peso_min && pala.peso_max ? `${pala.peso_min}-${pala.peso_max}g` : `${pala.peso_min || pala.peso_max}g`} />
                )}
                {pala.año > 0 && <TechRow label="Año" value={String(pala.año)} />}
              </div>
            </div>

            {(pala.rating_potencia > 0 || pala.rating_control > 0 || pala.rating_manejabilidad > 0 || pala.rating_punto_dulce > 0) && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 16 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, letterSpacing: 2, color: 'rgba(255,255,255,0.35)', marginBottom: 12, textTransform: 'uppercase' }}>Rendimiento</div>
                {pala.rating_potencia > 0 && <StatBar label="Potencia" value={pala.rating_potencia} />}
                {pala.rating_control > 0 && <StatBar label="Control" value={pala.rating_control} />}
                {pala.rating_manejabilidad > 0 && <StatBar label="Manejabilidad" value={pala.rating_manejabilidad} />}
                {pala.rating_punto_dulce > 0 && <StatBar label="Punto dulce" value={pala.rating_punto_dulce} />}
                {pala.rating_rebote > 0 && <StatBar label="Rebote" value={pala.rating_rebote} />}
              </div>
            )}
          </div>
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '1.5rem 2rem', background: '#0D0D0D' }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, letterSpacing: 3, color: 'rgba(255,255,255,0.35)', marginBottom: 12, textTransform: 'uppercase' }}>Mejores precios en tienda</div>
          <TiendasSection pala={pala} />
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '1.5rem 2rem', background: '#080808' }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, letterSpacing: 3, color: 'rgba(255,255,255,0.35)', marginBottom: 14, textTransform: 'uppercase' }}>Histórico de precios · últimos 60 días</div>
          <PriceHistorySection pala={pala} />
        </div>
      </div>
    </div>
  )
}

function PalaCard({ pala, onClick }: { pala: Pala; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ background: hovered ? '#161616' : '#111', border: `1px solid ${hovered ? 'rgba(200,255,0,0.2)' : 'rgba(255,255,255,0.07)'}`, cursor: 'pointer', transition: 'all 0.2s', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ background: '#cfcfcd', height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden', padding: '1rem' }}>
        {pala.imagen_url
          ? <img src={pala.imagen_url} alt={pala.nombre} style={{ maxHeight: 160, maxWidth: '100%', objectFit: 'contain', mixBlendMode: 'multiply', transition: 'transform 0.3s', transform: hovered ? 'scale(1.05)' : 'scale(1)' }} />
          : <span style={{ fontSize: 48 }}>🏓</span>
        }
      </div>

      <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, letterSpacing: 2, color: '#C8FF00', marginBottom: 4, textTransform: 'uppercase' }}>{pala.marca}</div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 17, letterSpacing: 1, lineHeight: 1.2, marginBottom: 10, flex: 1 }}>{pala.nombre}</div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
          {pala.forma && (
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', padding: '2px 7px', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.45)' }}>{pala.forma}</span>
          )}
          {pala.balance && (
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', padding: '2px 7px', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.45)' }}>{pala.balance}</span>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {pala.precio_referencia > 0 ? (
            <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20 }}>{pala.precio_referencia.toFixed(0)} €</span>
          ) : pala.precio_pvp > 0 ? (
            <span>
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20 }}>{pala.precio_pvp.toFixed(0)} €</span>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, color: 'rgba(255,255,255,0.3)', marginLeft: 4 }}>PVP</span>
            </span>
          ) : null}
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, letterSpacing: 1, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>Ver mejores precios →</span>
        </div>
      </div>
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, letterSpacing: 2.5, color: 'rgba(255,255,255,0.35)', marginBottom: 10, textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

function Pills({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(opt => (
        <button key={opt} onClick={() => onChange(value === opt ? '' : opt)} style={{
          background: value === opt ? 'rgba(200,255,0,0.12)' : 'none',
          border: `1px solid ${value === opt ? 'rgba(200,255,0,0.4)' : 'rgba(255,255,255,0.12)'}`,
          color: value === opt ? '#C8FF00' : 'rgba(255,255,255,0.5)',
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11,
          letterSpacing: 1.5, textTransform: 'uppercase', padding: '5px 10px',
          cursor: 'pointer', transition: 'all 0.15s',
        }}>{opt}</button>
      ))}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  width: '100%', background: '#161616', border: '1px solid rgba(255,255,255,0.1)',
  color: '#fff', fontFamily: "'Barlow', sans-serif", fontSize: 13,
  padding: '8px 10px', cursor: 'pointer', outline: 'none',
}

function FilterSidebar({ filters, setFilters, marcas, total }: {
  filters: Filters
  setFilters: (f: Filters) => void
  marcas: string[]
  total: number
}) {
  function update(key: keyof Filters, value: any) {
    setFilters({ ...filters, [key]: value })
  }

  return (
    <aside style={{ background: '#0F0F0F', borderRight: '1px solid rgba(255,255,255,0.07)', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'sticky', top: 54, height: 'calc(100vh - 54px)', overflowY: 'auto' }}>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 3, marginBottom: 4 }}>FILTROS</div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: 1 }}>{total} palas</div>
      </div>

      <button
        onClick={() => setFilters({ marca: '', forma: '', balance: '', juego: '', onlyChollos: false })}
        style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, letterSpacing: 2, padding: '8px', cursor: 'pointer', textTransform: 'uppercase' }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(200,255,0,0.3)'; e.currentTarget.style.color = '#C8FF00' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)' }}
      >Limpiar filtros</button>

      <div
        style={{ padding: '12px 14px', background: filters.onlyChollos ? 'rgba(200,255,0,0.08)' : '#161616', border: `1px solid ${filters.onlyChollos ? 'rgba(200,255,0,0.3)' : 'rgba(255,255,255,0.07)'}`, cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 10 }}
        onClick={() => update('onlyChollos', !filters.onlyChollos)}
      >
        <div style={{ width: 32, height: 18, background: filters.onlyChollos ? '#C8FF00' : 'rgba(255,255,255,0.1)', borderRadius: 9, position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 2, left: filters.onlyChollos ? 16 : 2, width: 14, height: 14, background: filters.onlyChollos ? '#000' : 'rgba(255,255,255,0.4)', borderRadius: '50%', transition: 'left 0.2s' }} />
        </div>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: filters.onlyChollos ? '#C8FF00' : 'rgba(255,255,255,0.5)' }}>Solo con chollos</span>
      </div>

      <FilterGroup label="Marca">
        <select value={filters.marca} onChange={e => update('marca', e.target.value)} style={selectStyle}>
          <option value="">Todas</option>
          {marcas.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </FilterGroup>

      <FilterGroup label="Forma">
        <Pills options={FORMAS} value={filters.forma} onChange={v => update('forma', v)} />
      </FilterGroup>

      <FilterGroup label="Balance">
        <Pills options={BALANCES} value={filters.balance} onChange={v => update('balance', v)} />
      </FilterGroup>

      <FilterGroup label="Nivel">
        <Pills options={JUEGOS} value={filters.juego} onChange={v => update('juego', v)} />
      </FilterGroup>
    </aside>
  )
}

export default function PalasPage() {
  const [palas, setPalas] = useState<Pala[]>([])
  const [loading, setLoading] = useState(true)
  const [marcas, setMarcas] = useState<string[]>([])
  const [filters, setFilters] = useState<Filters>({ marca: '', forma: '', balance: '', juego: '', onlyChollos: false })
  const [selected, setSelected] = useState<Pala | null>(null)
  const [search, setSearch] = useState('')
  // tarea (2026-06-30): el toggle "Solo con chollos" no filtraba nada — para
  // que filtre de verdad reutilizamos la MISMA logica de deteccion de chollos
  // que ya usa /chollos (umbrales, guards, etc. en app/api/chollos/route.ts),
  // en vez de reimplementarla aqui y arriesgar que las dos definiciones
  // diverjan con el tiempo.
  const [cholloPalaIds, setCholloPalaIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/chollos')
      .then(r => r.json())
      .then(data => {
        const ids = new Set<string>((data.chollos ?? []).map((c: any) => c.pala_id))
        setCholloPalaIds(ids)
      })
      .catch(err => console.error('Error cargando /api/chollos para el filtro', err))
  }, [])

  useEffect(() => {
    async function load() {
      // Supabase limita a 1000 filas por request — paginamos para obtener todas
      const PAGE = 1000
      let all: Pala[] = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('palas')
          .select('*')
          .order('marca', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) { console.error(error); break }
        all = all.concat((data ?? []) as Pala[])
        if ((data ?? []).length < PAGE) break
        from += PAGE
      }
      setPalas(all)
      const uniqueMarcas = Array.from(new Set(all.map(p => p.marca).filter(Boolean))).sort()
      setMarcas(uniqueMarcas)
      setLoading(false)
    }
    load()
  }, [])

  const filtered = palas.filter(p => {
    if (filters.marca && p.marca !== filters.marca) return false
    if (filters.forma && p.forma?.toLowerCase() !== filters.forma.toLowerCase()) return false
    if (filters.balance && p.balance?.toLowerCase() !== filters.balance.toLowerCase()) return false
    if (filters.juego && p.juego?.toLowerCase() !== filters.juego.toLowerCase()) return false
    if (filters.onlyChollos && !cholloPalaIds.has(p.id)) return false
    if (search) {
      const q = search.toLowerCase()
      if (!p.marca?.toLowerCase().includes(q) && !p.nombre?.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div className="app-shell" style={{ overflowX: 'hidden' }}>
      <Header />
      <BottomNav />
      <div className="hp-layout">
        <FilterSidebar filters={filters} setFilters={setFilters} marcas={marcas} total={filtered.length} />

        <main style={{ padding: '2rem', minHeight: 'calc(100vh - 54px)', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, letterSpacing: 4, marginBottom: 2 }}>CATÁLOGO DE PALAS</h1>
              <p style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, color: 'rgba(255,255,255,0.4)', letterSpacing: 1 }}>
                {filtered.length} palas · haz clic para ver chollos activos
              </p>
            </div>
            <input
              type="text" placeholder="Buscar marca o modelo..."
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: "'Barlow', sans-serif", fontSize: 14, padding: '10px 16px', outline: 'none', width: 280 }}
              onFocus={e => (e.target.style.borderColor = 'rgba(200,255,0,0.3)')}
              onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
            />
          </div>

          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'rgba(255,255,255,0.3)', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, letterSpacing: 3 }}>CARGANDO PALAS...</div>
          ) : filtered.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
              <div style={{ fontSize: 48 }}>🔍</div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, letterSpacing: 2, color: 'rgba(255,255,255,0.4)' }}>SIN RESULTADOS</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.05)' }}>
              {filtered.map(pala => (
                <div key={pala.id} style={{ background: '#080808' }}>
                  <PalaCard pala={pala} onClick={() => setSelected(pala)} />
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {selected && <PalaModal pala={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
