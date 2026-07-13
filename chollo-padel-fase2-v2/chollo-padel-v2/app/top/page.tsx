'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import BottomNav from '@/components/BottomNav'

interface TopItem {
  external_id:       string
  title:             string
  price:             number
  precio_medio:      number
  descuento_pct:     number
  score:             number
  condition:         string
  platform:          string
  img:               string | null
  url:               string
  city:              string | null
  keyword:           string
  updated_at:        string
  posicion:          number
  posicion_anterior: number | null
  puestos_movidos:   number | null
  tendencia:         'nueva_entrada' | 'sube' | 'baja' | 'igual' | null
}

const CONDITION_LABEL: Record<string, string> = {
  new:              'Nuevo',
  un_opened:        'Sin abrir',
  as_good_as_new:   'Como nuevo',
  good:             'Buen estado',
  fair:             'Aceptable',
  has_given_it_all: 'Para piezas',
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1)  return 'ahora mismo'
  if (diff < 60) return `hace ${diff} min`
  const h = Math.floor(diff / 60)
  if (h < 24)    return `hace ${h}h`
  return `hace ${Math.floor(h / 24)}d`
}

function TendenciaBadge({ tendencia, puestosMovidos }: {
  tendencia: TopItem['tendencia']
  puestosMovidos: number | null
}) {
  if (!tendencia || tendencia === 'igual') return null

  if (tendencia === 'nueva_entrada') {
    return (
      <div style={{
        position: 'absolute', top: 10, right: 10, zIndex: 2,
        background: '#C8FF00', color: '#000',
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
        padding: '2px 7px', borderRadius: 4,
        boxShadow: '0 0 8px rgba(200,255,0,0.5)',
      }}>
        🆕 NEW
      </div>
    )
  }

  if (tendencia === 'sube') {
    return (
      <div style={{
        position: 'absolute', top: 10, right: 10, zIndex: 2,
        background: 'rgba(21,128,61,0.12)', border: '1px solid rgba(21,128,61,0.3)',
        color: '#15803D', fontFamily: "'Space Grotesk', sans-serif",
        fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
      }}>
        ▲ +{puestosMovidos}
      </div>
    )
  }

  // baja
  return (
    <div style={{
      position: 'absolute', top: 10, right: 10, zIndex: 2,
      background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)',
      color: '#DC2626', fontFamily: "'Space Grotesk', sans-serif",
      fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
    }}>
      ▼ {puestosMovidos}
    </div>
  )
}

export default function TopPage() {
  const [items, setItems]         = useState<TopItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/top')
      .then(r => r.json())
      .then(data => {
        setItems(data.items ?? [])
        setUpdatedAt(data.updated_at ?? null)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const nuevas = items.filter(i => i.tendencia === 'nueva_entrada').length
  const suben  = items.filter(i => i.tendencia === 'sube').length
  const bajan  = items.filter(i => i.tendencia === 'baja').length

  return (
    <div className="app-shell">
      <Header />
      <BottomNav />

      <main style={s.main}>
        {/* Cabecera */}
        <div style={s.pageHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
            <h1 style={s.title}>🏆 Top Oportunidades</h1>
          </div>
          <p style={s.subtitle}>Los mejores chollos de segunda mano · solo Wallapop</p>
          {!loading && items.length > 0 && (nuevas > 0 || suben > 0 || bajan > 0) && (
            <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
              {nuevas > 0 && <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, color: 'var(--accent-fg)' }}>🆕 {nuevas} nueva{nuevas > 1 ? 's' : ''}</span>}
              {suben > 0  && <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, color: '#15803D' }}>▲ {suben} sube{suben > 1 ? 'n' : ''}</span>}
              {bajan > 0  && <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, color: '#DC2626' }}>▼ {bajan} baja{bajan > 1 ? 'n' : ''}</span>}
            </div>
          )}
          {updatedAt && (
            <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>
              Última actualización: {timeAgo(updatedAt)}
            </p>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div style={s.grid}>
            {[...Array(20)].map((_, i) => (
              <div key={i} style={s.skeleton} />
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && items.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--faint)', fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, letterSpacing: 2, marginTop: 80 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
            <div>AÚN NO HAY DATOS</div>
            <div style={{ fontSize: 13, marginTop: 8, opacity: 0.5 }}>El ranking se genera cada hora automáticamente</div>
          </div>
        )}

        {/* Grid */}
        {!loading && items.length > 0 && (
          <div style={s.grid}>
            {items.map((item, i) => {
              const rankColor = i === 0 ? '#FFB800' : i === 1 ? '#aaa' : i === 2 ? '#CD7F32' : 'var(--faint)'
              const condLabel = CONDITION_LABEL[item.condition] ?? item.condition
              const isNew  = item.condition === 'new' || item.condition === 'un_opened'

              return (
                <a
                  key={item.external_id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={s.card}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.borderColor = 'rgba(160,112,0,0.35)'
                    el.style.boxShadow   = 'var(--card-shadow-hover)'
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.borderColor = 'var(--border)'
                    el.style.boxShadow   = 'var(--card-shadow)'
                  }}
                >
                  {/* Rank badge */}
                  <div style={{ ...s.rankBadge, color: rankColor, borderColor: rankColor }}>
                    #{i + 1}
                  </div>

                  {/* Tendencia badge */}
                  <TendenciaBadge tendencia={item.tendencia ?? null} puestosMovidos={item.puestos_movidos ?? null} />

                  {/* Imagen */}
                  <div style={s.imgWrap}>
                    {item.img
                      ? <img src={item.img} alt={item.title} style={s.img} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      : <div style={s.imgPlaceholder}>🏓</div>
                    }
                  </div>

                  {/* Info */}
                  <div style={s.info}>
                    {/* Plataforma + ciudad */}
                    <p style={s.plataforma}>
                      {item.platform.toUpperCase()}
                      {item.city ? ` · ${item.city}` : ''}
                    </p>

                    {/* Título */}
                    <p style={s.titulo}>{item.title}</p>

                    {/* Condición */}
                    <div style={{
                      ...s.condBadge,
                      color: isNew ? 'var(--accent-fg)' : 'var(--muted)',
                      borderColor: isNew ? 'rgba(61,102,0,0.25)' : 'var(--border)',
                    }}>
                      {condLabel}
                    </div>

                    {/* Precio */}
                    <div style={s.precios}>
                      <span style={s.precio}>{item.price}€</span>
                      <span style={s.precioMedio}>ref {Math.round(item.precio_medio)}€</span>
                    </div>

                    {/* Descuento */}
                    <div style={s.descuento}>
                      -{item.descuento_pct}% vs mediana segunda mano
                    </div>

                    {/* Footer */}
                    <div style={s.footer}>
                      <span style={s.keyword}>{item.keyword}</span>
                      <span style={s.tiempo}>{timeAgo(item.updated_at)}</span>
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        )}

        <p style={s.nota}>
          El % de descuento se calcula sobre la mediana de precios de segunda mano del mismo modelo en Wallapop.
          Solo se incluyen artículos en estado nuevo, sin abrir o como nuevo con precio superior a 30€ y descuento ≥ 25%.
          ▲▼ indican movimiento respecto al ranking anterior.
        </p>
      </main>
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
  pageHeader: { marginBottom: 28 },
  title: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 36,
    fontWeight: 700,
    letterSpacing: -0.5,
    color: 'var(--text)',
    margin: 0,
  },
  subtitle: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 13,
    color: 'var(--muted)',
    margin: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 20,
    marginBottom: 32,
  },
  skeleton: {
    background: 'linear-gradient(90deg, var(--bg3) 25%, var(--bg4) 50%, var(--bg3) 75%)',
    backgroundSize: '200% 100%',
    borderRadius: 10,
    height: 340,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--card)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--card-shadow)',
    textDecoration: 'none',
    color: 'inherit',
    position: 'relative',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    cursor: 'pointer',
    borderRadius: 10,
    overflow: 'hidden',
  },
  rankBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 2,
    fontFamily: 'Bebas Neue, sans-serif',
    fontSize: 18,
    lineHeight: 1,
    padding: '2px 8px',
    border: '1.5px solid',
    borderRadius: 4,
    background: 'rgba(255,255,255,0.85)',
    backdropFilter: 'blur(4px)',
  },
  imgWrap: {
    width: '100%',
    height: 220,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#1a1a1a',
    overflow: 'hidden',
  },
  img: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'center',
  },
  imgPlaceholder: {
    fontSize: 48,
    opacity: 0.15,
  },
  info: {
    padding: '14px 14px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    flex: 1,
  },
  plataforma: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 11,
    letterSpacing: 2,
    color: 'var(--muted)',
    margin: 0,
    textTransform: 'uppercase',
  },
  titulo: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: 0.3,
    color: 'var(--text)',
    margin: 0,
    lineHeight: 1.3,
  },
  condBadge: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 10,
    letterSpacing: 1,
    padding: '1px 6px',
    border: '1px solid',
    borderRadius: 3,
    width: 'fit-content',
    marginTop: 4,
  },
  precios: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 8,
  },
  precio: {
    fontFamily: 'Bebas Neue, sans-serif',
    fontSize: 26,
    letterSpacing: 1,
    color: 'var(--text)',
    lineHeight: 1,
  },
  precioMedio: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 12,
    color: 'var(--faint)',
    textDecoration: 'line-through',
  },
  descuento: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: '#FFB800',
    background: 'rgba(255,184,0,0.10)',
    borderRadius: 4,
    padding: '2px 7px',
    width: 'fit-content',
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
  keyword: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 10,
    letterSpacing: 0.5,
    color: 'var(--faint)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '65%',
  },
  tiempo: {
    fontFamily: 'Space Grotesk, sans-serif',
    fontSize: 11,
    color: 'var(--faint)',
    flexShrink: 0,
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
