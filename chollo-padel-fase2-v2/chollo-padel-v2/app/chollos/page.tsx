'use client'

import { useEffect, useState } from 'react'
import type { CholloTienda } from '@/app/api/chollos/route'
import Header from '@/components/Header'
import BottomNav from '@/components/BottomNav'

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
          <h1 style={s.title}>CHOLLOS</h1>
          <p style={s.subtitle}>
            BAJADAS DE PRECIO EN TIENDAS - ACTUALIZADO {totalStats.updated_at ? timeAgo(totalStats.updated_at).toUpperCase() : 'HOY'}
          </p>
        </div>

        {/* Stats rapidos */}
        {!loading && !error && (
          <div style={s.statsRow}>
            <div style={s.statBox}>
              <span style={s.statNum}>{totalStats.total}</span>
              <span style={s.statLbl}>ofertas encontradas</span>
            </div>
            <div style={{ ...s.statBox, borderColor: '#FF5F1F44' }}>
              <span style={{ ...s.statNum, color: '#FF5F1F' }}>{totalStats.chollos}</span>
              <span style={s.statLbl}>CHOLLOS &gt;=35%</span>
            </div>
            <div style={{ ...s.statBox, borderColor: '#FFB80044' }}>
              <span style={{ ...s.statNum, color: '#FFB800' }}>{totalStats.ofertas}</span>
              <span style={s.statLbl}>OFERTAS &gt;=25%</span>
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
                style={{
                  ...s.filtroBtn,
                  ...(filtro === f ? s.filtroBtnActive : {}),
                }}
              >
                {f === 'todos' ? `TODOS (${totalStats.total})`
                  : f === 'CHOLLO' ? `CHOLLO (${totalStats.chollos})`
                  : `OFERTA (${totalStats.ofertas})`}
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
            <p style={{ ...s.estadoTxt, fontSize: 12, marginTop: 8, color: 'rgba(255,255,255,0.2)' }}>
              Los precios se actualizan automaticamente 4 veces al dia.
            </p>
          </div>
        )}

        {/* Grid de chollos */}
        {!loading && !error && visible.length > 0 && (
          <div style={s.grid}>
            {visible.map((c, i) => (
              <a key={`${c.pala_id}-${c.tienda_slug}`} href={c.url_producto} target="_blank" rel="noopener noreferrer" style={s.card}>
                {/* Badge tag */}
                <div style={{
                  ...s.tagBadge,
                  background: c.tag === 'CHOLLO' ? '#FF5F1F' : '#FFB800',
                  color: c.tag === 'CHOLLO' ? '#fff' : '#000',
                }}>
                  {c.tag === 'CHOLLO' ? 'CHOLLO' : 'OFERTA'}
                </div>

                {/* Badge NUEVO (chollo detectado en las últimas 48h) */}
                {c.primera_vez_at && (Date.now() - new Date(c.primera_vez_at).getTime()) < 48 * 60 * 60 * 1000 && (
                  <div style={{
                    position: 'absolute', top: 8, right: 8,
                    background: '#C8FF00', color: '#000',
                    fontFamily: "'Barlow Condensed', sans-serif",
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
                    color: c.tag === 'CHOLLO' ? '#FF5F1F' : '#FFB800',
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
              </a>
            ))}
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
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  main: {
    flex: 1,
    padding: '24px 28px',
    overflowY: 'auto',
    background: '#080808',
    display: 'flex',
    flexDirection: 'column',
  },
  pageHeader: { marginBottom: 28 },
  title: {
    fontFamily: 'Bebas Neue, sans-serif',
    fontSize: 48,
    letterSpacing: 4,
    color: '#FF5F1F',
    margin: 0,
  },
  subtitle: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 12,
    letterSpacing: 1.5,
    color: 'rgba(255,255,255,0.35)',
    marginTop: 6,
  },
  statsRow: {
    display: 'flex',
    gap: 12,
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  statBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '14px 24px',
    border: '1px solid rgba(255,255,255,0.08)',
    background: '#111',
    minWidth: 100,
  },
  statNum: {
    fontFamily: 'Bebas Neue, sans-serif',
    fontSize: 32,
    letterSpacing: 2,
    color: '#fff',
    lineHeight: 1,
  },
  statLbl: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 11,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.35)',
    marginTop: 4,
  },
  filtros: {
    display: 'flex',
    gap: 8,
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  filtroBtn: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1.5,
    padding: '7px 16px',
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.4)',
    cursor: 'pointer',
  },
  filtroBtnActive: {
    border: '1px solid #FF5F1F',
    color: '#FF5F1F',
    background: 'rgba(255,95,31,0.06)',
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
    border: '2px solid rgba(255,255,255,0.1)',
    borderTop: '2px solid #FF5F1F',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  estadoTxt: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 14,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.3)',
    margin: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 16,
    marginBottom: 32,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    background: '#111',
    border: '1px solid rgba(255,255,255,0.07)',
    textDecoration: 'none',
    position: 'relative',
    transition: 'border-color 0.15s',
    cursor: 'pointer',
  },
  tagBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.5,
    padding: '3px 8px',
    zIndex: 1,
  },
  imgWrap: {
    width: '100%',
    height: 160,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#cfcfcd',
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
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 11,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.35)',
    margin: 0,
    textTransform: 'uppercase',
  },
  modelo: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: '#fff',
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
    color: '#fff',
    lineHeight: 1,
  },
  precioRef: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
  },
  precioRefTachado: {
    textDecoration: 'line-through',
  },
  precioSinCodigo: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 13,
    color: 'rgba(255,255,255,0.3)',
    textDecoration: 'line-through',
  },
  codigoBanner: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: '#00D2A0',
    background: 'rgba(0,210,160,0.1)',
    border: '1px solid rgba(0,210,160,0.3)',
    padding: '3px 8px',
    marginTop: 6,
    width: 'fit-content',
  },
  descuento: {
    fontFamily: 'Barlow Condensed, sans-serif',
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
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  tienda: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 11,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.25)',
    textTransform: 'uppercase',
  },
  tpStars: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.5,
  },
  tiempo: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 11,
    color: 'rgba(255,255,255,0.18)',
  },
  nota: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 11,
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.18)',
    textAlign: 'center',
    marginTop: 8,
  },
}
