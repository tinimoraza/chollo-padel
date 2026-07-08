'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import type { CholloTienda } from '@/app/api/chollos/route'
import Header from '@/components/Header'
import BottomNav from '@/components/BottomNav'
import { PalaModal } from '@/components/PalaModal'
import type { Pala } from '@/components/PalaModal'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)

type Filtro = 'todos' | 'CHOLLO' | 'OFERTA'

const TIENDA_LABEL: Record<string, string> = {
  padelnuestro:    'Padel Nuestro',
  padelzoom:       'PadelZoom',
  romasport:       'Roma Sport',
  padelcoronado:   'Padel Coronado',
  padelmarket:     'Padelmarket',
  padeliberico:    'Padel Iberico',
  tennispoint:     'Tennis Point',
  keepadel:        'Keepadel',
  time2padel:      'Time2Padel',
  padelproshop:    'Padel Pro Shop',
  padelspain:      'Padel Spain',
  padeltienda:     'Padel Tienda',
  padelvice:       'Padelvice',
  stockpadel:      'Stock Padel',
  starvie:         'Starvie',
  ofertasdepadel:  'Ofertas de Padel',
  zonadepadel:     'Zona de Padel',
  padelkiwi:       'Padelkiwi',
  padelstyle:      'Padelstyle',
  misterpadel:     'Mister Padel',
  outletdepadel:   'Outlet de Padel',
  originalpadel:   'Original Padel',
  streetpadel:     'Street Padel',
  m1padel:         'M1 Padel',
  justpadel:       'Just Padel',
  futurapadelshop: 'Futura Padel',
  virtualpadel:    'Virtual Padel',
  padelmania:      'Padelmania',
  pelotapadel:     'PelotaPadel',
  allforpadel:     'All For Padel',
  tiendapadel5:    'Tienda Padel 5',
  tiendapadelpoint:'Padelpoint',
}

// Rating Trustpilot (★ sobre 5) — auditado 2026-07-01
// null = sin perfil o sin reseñas suficientes
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
  stockpadel:      4,
  tennispoint:     3.5,
  allforpadel:     3.5,
  padelstyle:      3.5,
  originalpadel:   3,
  futurapadelshop: 3,
  padelspain:      3,
  pelotapadel:     4.5,   // 4.7 sobre 5 — 1.279 reseñas
  // sin datos / sin reseñas suficientes
  outletdepadel:   null,
  padelzoom:       null,
  padeltienda:     null,
  romasport:       null,
  padelcoronado:   null,
  padelvice:       null,
  streetpadel:     null,
  m1padel:         null,
  starvie:         null,
}

function tpColor(stars: number): string {
  if (stars >= 4)   return '#00B67A' // verde Trustpilot
  if (stars >= 3.5) return '#FFB800' // amarillo
  return '#FF5F1F'                   // rojo/naranja
}

function formatModelo(nombre: string, marca: string): string {
  if (!nombre) return nombre
  const marcaNorm = marca.trim().toLowerCase()
  const sinMarca = nombre.replace(new RegExp(`^${marcaNorm}\\s+`, 'i'), '')
  return sinMarca || nombre
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 60)  return `hace ${diff} min`
  const h = Math.floor(diff / 60)
  if (h < 24)    return `hace ${h}h`
  return `hace ${Math.floor(h / 24)}d`
}

export default function ChollosPage() {
  const [chollos, setChollos]     = useState<CholloTienda[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [filtro, setFiltro]       = useState<Filtro>('todos')
  const [totalStats, setTotalStats] = useState({ total: 0, chollos: 0, ofertas: 0, updated_at: null as string | null })
  const [selectedPala, setSelectedPala] = useState<Pala | null>(null)
  const [palaLoading, setPalaLoading]   = useState(false)

  async function handleCholloClick(c: CholloTienda) {
    setPalaLoading(true)
    const { data, error } = await supabase
      .from('palas')
      .select('*')
      .eq('id', c.pala_id)
      .single()
    setPalaLoading(false)
    if (!error && data) setSelectedPala(data as Pala)
  }

  useEffect(() => {
    fetch('/api/chollos')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setChollos(data.chollos ?? [])
        setTotalStats({
          total:      data.total ?? 0,
          chollos:    data.chollos_count ?? 0,
          ofertas:    data.ofertas_count ?? 0,
          updated_at: data.updated_at ?? null,
        })
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const visible = filtro === 'todos' ? chollos : chollos.filter(c => c.tag === filtro)

  return (
    <div className="app-shell">
      <Header />
      <BottomNav />

      <main style={s.main}>
        {/* Cabecera */}
        <div style={s.pageHeader}>
          <div style={s.titleRow}>
            <h1 style={s.title}>Chollos</h1>
            {totalStats.updated_at && (
              <div style={s.livePill}>
                <span style={s.liveDot} />
                {timeAgo(totalStats.updated_at)}
              </div>
            )}
          </div>
          <p style={s.subtitle}>Bajadas de precio detectadas en tiendas de pádel</p>
        </div>

        {/* Stats rapidos */}
        {!loading && !error && (
          <div style={s.statsRow}>
            <div style={s.statBox}>
              <span style={s.statNum}>{totalStats.total}</span>
              <span style={s.statLbl}>ofertas activas</span>
            </div>
            <div style={{ ...s.statBox, borderColor: 'rgba(204,255,0,0.35)', background: 'rgba(204,255,0,0.07)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ ...s.statNum, color: 'var(--chollo-fg)' }}>{totalStats.chollos}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#5a9000', letterSpacing: 0.5 }}>⚡</span>
              </div>
              <span style={s.statLbl}>chollos &gt; 35% dto.</span>
            </div>
            <div style={{ ...s.statBox, borderColor: 'rgba(37,99,235,0.20)', background: 'var(--blue-dim)' }}>
              <span style={{ ...s.statNum, color: 'var(--blue-fg)' }}>{totalStats.ofertas}</span>
              <span style={s.statLbl}>ofertas &gt; 25% dto.</span>
            </div>
          </div>
        )}

        {/* Filtros */}
        {!loading && !error && totalStats.total > 0 && (
          <div style={s.filtros}>
            {(['todos', 'CHOLLO', 'OFERTA'] as Filtro[]).map(f => (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                style={{ ...s.filtroBtn, ...(filtro === f ? s.filtroBtnActive : {}) }}
              >
                {f === 'todos' ? `Todos (${totalStats.total})`
                  : f === 'CHOLLO' ? `⚡ Chollos (${totalStats.chollos})`
                  : `Ofertas (${totalStats.ofertas})`}
              </button>
            ))}
          </div>
        )}

        {/* Estados */}
        {loading && (
          <div style={s.estado}>
            <div style={s.spinner} />
            <p style={s.estadoTxt}>Buscando chollos en tiendas...</p>
          </div>
        )}

        {error && (
          <div style={s.estado}>
            <p style={{ ...s.estadoTxt, color: '#FF5F1F' }}>Error: {error}</p>
          </div>
        )}

        {!loading && !error && totalStats.total === 0 && (
          <div style={s.estado}>
            <p style={s.estadoTxt}>No hay bajadas de precio significativas ahora mismo.</p>
            <p style={{ ...s.estadoTxt, fontSize: 12, marginTop: 8, color: 'var(--faint)' }}>
              Los precios se actualizan automaticamente 4 veces al dia.
            </p>
          </div>
        )}

        {/* Grid de chollos */}
        {!loading && !error && visible.length > 0 && (
          <div style={s.grid}>
            {visible.map((c, i) => {
              const inner = (
                <>
                  {/* Badge tag */}
                  <div style={{
                    ...s.tagBadge,
                    background: c.tag === 'CHOLLO' ? '#CCFF00' : '#2563EB',
                    color: c.tag === 'CHOLLO' ? '#1a3300' : '#fff',
                    boxShadow: c.tag === 'CHOLLO' ? '0 0 10px rgba(204,255,0,0.50)' : 'none',
                  }}>
                    {c.tag === 'CHOLLO' ? '⚡ CHOLLO' : 'OFERTA'}
                  </div>

                  {/* Badge NUEVO (chollo detectado en las últimas 24h) */}
                  {c.primera_vez_at && (Date.now() - new Date(c.primera_vez_at).getTime()) < 24 * 60 * 60 * 1000 && (
                    <div style={{
                      position: 'absolute', top: 8, right: 8,
                      background: '#C8FF00', color: '#000',
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
                      padding: '2px 7px', textTransform: 'uppercase',
                      boxShadow: '0 0 8px rgba(200,255,0,0.5)',
                    }}>
                      NUEVO
                    </div>
                  )}

                  {/* Imagen */}
                  <div style={s.imgWrap}>
                    {c.imagen_url
                      ? <img src={c.imagen_url} alt={c.nombre} style={s.img} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      : <div style={s.imgPlaceholder}>PADEL</div>
                    }
                  </div>

                  {/* Info pala */}
                  <div style={s.info}>
                    <p style={s.marca}>{c.marca}</p>
                    <p style={s.modelo}>{formatModelo(c.nombre, c.marca)}</p>

                    {/* Banner codigo de descuento (tarea #175) */}
                    {c.codigo_descuento && (
                      <div style={s.codigoBanner}>
                        CODIGO {c.codigo_descuento} -{c.descuento_codigo_pct}% EXTRA
                      </div>
                    )}

                    {/* Precios */}
                    <div style={s.precios}>
                      <span style={s.precioActual}>{c.precio_actual.toFixed(2)}€</span>
                      {c.precio_sin_codigo && (
                        <span style={s.precioSinCodigo}>{c.precio_sin_codigo.toFixed(2)}€</span>
                      )}
                      <span style={s.precioRef}>
                        <span style={s.precioRefTachado}>ref {c.precio_referencia.toFixed(0)}€</span>
                      </span>
                    </div>

                    {/* Descuento */}
                    <div style={{
                      ...s.descuento,
                      background: c.tag === 'CHOLLO' ? 'rgba(204,255,0,0.18)' : 'rgba(37,99,235,0.10)',
                      color: c.tag === 'CHOLLO' ? '#2d5200' : '#1D4ED8',
                      borderRadius: 4,
                      padding: '2px 7px',
                      width: 'fit-content',
                    }}>
                      -{c.descuento_pct}% vs precio medio tiendas
                    </div>

                    {/* Tienda, rating Trustpilot y tiempo */}
                    <div style={s.footer}>
                      <span style={s.tienda}>
                        {TIENDA_LABEL[c.tienda_slug] ?? c.tienda}
                        {TIENDA_TP[c.tienda_slug] != null && (
                          <span style={{ ...s.tpStars, color: tpColor(TIENDA_TP[c.tienda_slug]!) }}>
                            {' '}★{TIENDA_TP[c.tienda_slug]}
                          </span>
                        )}
                      </span>
                      <span style={s.tiempo}>{timeAgo(c.scraped_at)}</span>
                    </div>
                  </div>
                </>
              )
              return c.slug
                ? <Link key={`${c.pala_id}-${c.tienda_slug}`} href={`/palas/${c.slug}`} style={{ ...s.card, textDecoration: 'none', color: 'inherit' }}>
                    {inner}
                  </Link>
                : <div key={`${c.pala_id}-${c.tienda_slug}`} onClick={() => handleCholloClick(c)} style={s.card}>
                    {inner}
                  </div>
            })}
          </div>
        )}

        {/* Nota explicativa */}
        {!loading && !error && (
          <p style={s.nota}>
            El precio de referencia es la media de las ultimas 4 semanas en tiendas.
            Se actualiza automaticamente 4 veces al dia.
          </p>
        )}
      </main>

      {/* Loading overlay mientras se carga la pala */}
      {palaLoading && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 32, height: 32, border: '3px solid rgba(255,255,255,0.3)', borderTop: '3px solid #fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {/* Modal pala */}
      {selectedPala && (
        <PalaModal pala={selectedPala} onClose={() => setSelectedPala(null)} />
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  main: {
    flex: 1,
    padding: '24px 28px',
    overflowY: 'auto',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
  },
  pageHeader: { marginBottom: 32 },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 6,
  },
  title: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 36,
    fontWeight: 700,
    letterSpacing: -0.5,
    color: 'var(--text)',
    margin: 0,
  },
  livePill: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    borderRadius: 20,
    background: 'rgba(34,197,94,0.1)',
    border: '1px solid rgba(34,197,94,0.25)',
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 11,
    fontWeight: 500,
    color: 'rgba(34,197,94,0.85)',
    whiteSpace: 'nowrap' as const,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#22c55e',
    boxShadow: '0 0 6px rgba(34,197,94,0.7)',
    animation: 'pulse 2s ease-in-out infinite',
    display: 'inline-block',
  },
  subtitle: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 13,
    fontWeight: 400,
    color: 'var(--muted)',
    margin: 0,
    letterSpacing: 0,
  },
  statsRow: {
    display: 'flex',
    gap: 12,
    marginBottom: 28,
    flexWrap: 'wrap' as const,
  },
  statBox: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
    padding: '16px 20px',
    border: '1px solid var(--border)',
    background: 'var(--card)',
    boxShadow: 'var(--card-shadow)',
    borderRadius: 10,
    minWidth: 110,
    gap: 2,
  },
  statNum: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 36,
    fontWeight: 700,
    letterSpacing: -1,
    color: 'var(--text)',
    lineHeight: 1,
  },
  statLbl: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--muted)',
    marginTop: 4,
    letterSpacing: 0,
  },
  filtros: {
    display: 'flex',
    gap: 6,
    marginBottom: 24,
    flexWrap: 'wrap' as const,
  },
  filtroBtn: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: 0,
    padding: '7px 18px',
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--muted)',
    cursor: 'pointer',
    borderRadius: 20,
    transition: 'all 0.15s',
  },
  filtroBtnActive: {
    border: '1px solid var(--blue)',
    color: 'var(--blue-fg)',
    background: 'var(--blue-dim)',
    fontWeight: 600,
  },
  estado: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
    gap: 12,
  },
  spinner: {
    width: 28,
    height: 28,
    border: '2px solid var(--border)',
    borderTop: '2px solid var(--blue)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  estadoTxt: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 14,
    letterSpacing: 1,
    color: 'var(--muted)',
    margin: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 20,
    marginBottom: 32,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--card)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--card-shadow)',
    textDecoration: 'none',
    position: 'relative',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    cursor: 'pointer',
    borderRadius: 10,
    overflow: 'hidden',
  },
  tagBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.5,
    padding: '3px 8px',
    zIndex: 1,
    borderRadius: 4,
  },
  imgWrap: {
    width: '100%',
    height: 210,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#E8E9EC',
    overflow: 'hidden',
  },
  img: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    mixBlendMode: 'multiply' as const,
    padding: 12,
  },
  imgPlaceholder: {
    fontSize: 18,
    opacity: 0.2,
  },
  info: {
    padding: '14px 14px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    flex: 1,
  },
  marca: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 11,
    letterSpacing: 2,
    color: 'var(--muted)',
    margin: 0,
    textTransform: 'uppercase',
  },
  modelo: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: 'var(--text)',
    margin: 0,
    lineHeight: 1.2,
  },
  precios: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 8,
  },
  precioActual: {
    fontFamily: 'Bebas Neue, sans-serif',
    fontSize: 26,
    letterSpacing: 1,
    color: 'var(--text)',
    lineHeight: 1,
  },
  precioRef: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 12,
    color: 'var(--faint)',
  },
  precioRefTachado: {
    textDecoration: 'line-through',
  },
  precioSinCodigo: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 13,
    color: 'var(--faint)',
    textDecoration: 'line-through',
  },
  codigoBanner: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: '#1D4ED8',
    background: 'rgba(37,99,235,0.08)',
    border: '1px solid rgba(37,99,235,0.25)',
    padding: '3px 8px',
    marginTop: 6,
    width: 'fit-content',
    borderRadius: 4,
  },
  descuento: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px solid var(--border)',
  },
  tienda: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 11,
    letterSpacing: 1,
    color: 'var(--faint)',
    textTransform: 'uppercase',
  },
  tpStars: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.5,
  },
  tiempo: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 11,
    color: 'var(--faint)',
  },
  nota: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 11,
    letterSpacing: 0.5,
    color: 'var(--faint)',
    textAlign: 'center',
    marginTop: 8,
  },
}
