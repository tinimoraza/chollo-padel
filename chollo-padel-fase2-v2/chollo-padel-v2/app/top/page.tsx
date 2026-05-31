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

// Color del badge de condición — diferencia visualmente new/un_opened del resto
const CONDITION_COLOR: Record<string, string> = {
  new:            '#C8FF00',
  un_opened:      '#C8FF00',
  as_good_as_new: 'rgba(255,255,255,0.35)',
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1)  return 'ahora mismo'
  if (diff < 60) return `hace ${diff} min`
  const h = Math.floor(diff / 60)
  if (h < 24)    return `hace ${h}h`
  return `hace ${Math.floor(h / 24)}d`
}

// Componente de tendencia — el corazón del cambio
function TendenciaBadge({ tendencia, puestosMovidos }: {
  tendencia: TopItem['tendencia']
  puestosMovidos: number | null
}) {
  if (!tendencia || tendencia === 'igual') {
    return (
      <div style={{
        width: 36,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
      }}>
        <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.15)', lineHeight: 1 }}>—</span>
      </div>
    )
  }

  if (tendencia === 'nueva_entrada') {
    return (
      <div style={{
        width: 36,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}>
        <span style={{ fontSize: 11, lineHeight: 1 }}>🆕</span>
        <span style={{
          fontSize: 8,
          fontFamily: 'Barlow Condensed, sans-serif',
          letterSpacing: 0.5,
          color: '#C8FF00',
          fontWeight: 700,
          lineHeight: 1,
          textAlign: 'center',
        }}>NEW</span>
      </div>
    )
  }

  if (tendencia === 'sube') {
    return (
      <div style={{
        width: 36,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
      }}>
        <span style={{ fontSize: 16, lineHeight: 1 }}>▲</span>
        <span style={{
          fontSize: 11,
          fontFamily: 'Bebas Neue, Barlow Condensed, sans-serif',
          color: '#4ADE80',
          lineHeight: 1,
        }}>
          +{puestosMovidos}
        </span>
      </div>
    )
  }

  // baja
  return (
    <div style={{
      width: 36,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 1,
    }}>
      <span style={{ fontSize: 16, lineHeight: 1, color: '#F87171' }}>▼</span>
      <span style={{
        fontSize: 11,
        fontFamily: 'Bebas Neue, Barlow Condensed, sans-serif',
        color: '#F87171',
        lineHeight: 1,
      }}>
        {puestosMovidos}
      </span>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: '100vh',
    background: '#080808',
    padding: '32px 24px',
    maxWidth: 900,
    margin: '0 auto',
  },
  header: {
    marginBottom: 32,
  },
  title: {
    fontFamily: 'Bebas Neue, Barlow Condensed, sans-serif',
    fontSize: 40,
    letterSpacing: 4,
    color: '#FFB800',
    lineHeight: 1,
    margin: 0,
  },
  subtitle: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 13,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.35)',
    marginTop: 8,
  },
  updatedAt: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 12,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.2)',
    marginTop: 4,
  },
  emptyState: {
    textAlign: 'center' as const,
    color: 'rgba(255,255,255,0.25)',
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 16,
    letterSpacing: 2,
    marginTop: 80,
  },
  list: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  card: {
    background: '#111111',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    textDecoration: 'none',
    color: 'inherit',
    transition: 'border-color 0.2s',
    position: 'relative' as const,
    overflow: 'hidden',
  },
  rank: {
    fontFamily: 'Bebas Neue, sans-serif',
    fontSize: 28,
    color: 'rgba(255,255,255,0.12)',
    minWidth: 32,
    textAlign: 'center' as const,
    lineHeight: 1,
  },
  tendenciaCol: {
    minWidth: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  img: {
    width: 72,
    height: 72,
    objectFit: 'cover' as const,
    borderRadius: 6,
    background: '#1a1a1a',
    flexShrink: 0,
  },
  imgPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 6,
    background: '#1a1a1a',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: 0.5,
    color: '#fff',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    marginBottom: 4,
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  condBadge: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 11,
    letterSpacing: 1,
    padding: '1px 7px',
    borderRadius: 3,
  },
  platformBadge: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 11,
    letterSpacing: 1,
    color: '#C8FF00',
    opacity: 0.6,
  },
  cityText: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 11,
    color: 'rgba(255,255,255,0.25)',
    letterSpacing: 0.5,
  },
  priceBlock: {
    textAlign: 'right' as const,
    flexShrink: 0,
  },
  price: {
    fontFamily: 'Bebas Neue, Barlow Condensed, sans-serif',
    fontSize: 26,
    fontWeight: 700,
    color: '#FFB800',
    lineHeight: 1,
  },
  precioMedio: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 13,
    color: 'rgba(255,255,255,0.3)',
    textDecoration: 'line-through',
    marginTop: 2,
  },
  discountBadge: {
    fontFamily: 'Bebas Neue, Barlow Condensed, sans-serif',
    fontSize: 13,
    letterSpacing: 1,
    color: '#080808',
    background: '#FFB800',
    padding: '2px 8px',
    borderRadius: 4,
    marginTop: 4,
    display: 'inline-block',
  },
  accentBar: {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    background: '#FFB800',
    borderRadius: '10px 0 0 10px',
  },
  skeleton: {
    background: 'linear-gradient(90deg, #111 25%, #1a1a1a 50%, #111 75%)',
    backgroundSize: '200% 100%',
    borderRadius: 10,
    height: 102,
  },
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

  // Contar movimientos para el subtítulo
  const nuevas  = items.filter(i => i.tendencia === 'nueva_entrada').length
  const suben   = items.filter(i => i.tendencia === 'sube').length
  const bajan   = items.filter(i => i.tendencia === 'baja').length

  return (
    <div className="app-shell">
      <Header />
      <BottomNav />

      <main style={styles.main}>
        <div style={styles.header}>
          <h1 style={styles.title}>🏆 TOP OPORTUNIDADES</h1>
          <p style={styles.subtitle}>
            LOS {items.length || 10} MEJORES CHOLLOS DE SEGUNDA MANO · ACTUALIZADO CADA HORA
          </p>
          {/* Resumen de movimientos, solo si hay datos */}
          {!loading && items.length > 0 && (nuevas > 0 || suben > 0 || bajan > 0) && (
            <p style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontSize: 12,
              letterSpacing: 1,
              color: 'rgba(255,255,255,0.25)',
              marginTop: 6,
              display: 'flex',
              gap: 12,
            }}>
              {nuevas > 0 && <span style={{ color: '#C8FF00' }}>🆕 {nuevas} nueva{nuevas > 1 ? 's' : ''}</span>}
              {suben > 0  && <span style={{ color: '#4ADE80' }}>▲ {suben} sube{suben > 1 ? 'n' : ''}</span>}
              {bajan > 0  && <span style={{ color: '#F87171' }}>▼ {bajan} baja{bajan > 1 ? 'n' : ''}</span>}
            </p>
          )}
          {updatedAt && (
            <p style={styles.updatedAt}>Última actualización: {timeAgo(updatedAt)}</p>
          )}
        </div>

        {loading ? (
          <div style={styles.list}>
            {[...Array(5)].map((_, i) => (
              <div key={i} style={styles.skeleton} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
            <div>AÚN NO HAY DATOS</div>
            <div style={{ fontSize: 13, marginTop: 8, opacity: 0.5 }}>
              El ranking se genera cada hora automáticamente
            </div>
          </div>
        ) : (
          <div style={styles.list}>
            {items.map((item, i) => {
              // Barra de acento: verde si es nueva entrada, normal si no
              const accentColor = item.tendencia === 'nueva_entrada'
                ? '#C8FF00'
                : item.tendencia === 'sube'
                ? '#4ADE80'
                : '#FFB800'

              const condColor = CONDITION_COLOR[item.condition] ?? 'rgba(255,255,255,0.35)'
              const condBorderColor = item.condition === 'new' || item.condition === 'un_opened'
                ? 'rgba(200,255,0,0.3)'
                : 'rgba(255,255,255,0.1)'

              return (
                <a
                  key={item.external_id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.card}
                  onMouseEnter={e => {
                    ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,184,0,0.35)'
                  }}
                  onMouseLeave={e => {
                    ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)'
                  }}
                >
                  {/* Barra de acento izquierda — cambia color según tendencia */}
                  <div style={{ ...styles.accentBar, background: accentColor }} />

                  {/* Número de ranking */}
                  <div style={{
                    ...styles.rank,
                    color: i === 0
                      ? '#FFB800'
                      : i === 1
                      ? 'rgba(255,255,255,0.4)'
                      : i === 2
                      ? '#CD7F32'
                      : 'rgba(255,255,255,0.12)',
                  }}>
                    #{i + 1}
                  </div>

                  {/* Columna de tendencia */}
                  <div style={styles.tendenciaCol}>
                    <TendenciaBadge
                      tendencia={item.tendencia ?? null}
                      puestosMovidos={item.puestos_movidos ?? null}
                    />
                  </div>

                  {/* Imagen */}
                  {item.img ? (
                    <img src={item.img} alt={item.title} style={styles.img} />
                  ) : (
                    <div style={styles.imgPlaceholder}>🏓</div>
                  )}

                  {/* Info */}
                  <div style={styles.info}>
                    <div style={styles.itemTitle}>{item.title}</div>
                    <div style={styles.meta}>
                      <span style={{
                        ...styles.condBadge,
                        color: condColor,
                        border: `1px solid ${condBorderColor}`,
                      }}>
                        {CONDITION_LABEL[item.condition] ?? item.condition}
                      </span>
                      <span style={styles.platformBadge}>
                        ◈ {item.platform.toUpperCase()}
                      </span>
                      {item.city && (
                        <span style={styles.cityText}>{item.city}</span>
                      )}
                    </div>
                  </div>

                  {/* Precio + descuento */}
                  <div style={styles.priceBlock}>
                    <div style={styles.price}>{item.price}€</div>
                    <div style={styles.precioMedio}>{Math.round(item.precio_medio)}€</div>
                    <div style={styles.discountBadge}>-{item.descuento_pct}%</div>
                  </div>
                </a>
              )
            })}
          </div>
        )}

        <p style={{
          marginTop: 32,
          fontSize: 12,
          color: 'rgba(255,255,255,0.15)',
          fontFamily: 'Barlow Condensed, sans-serif',
          letterSpacing: 1,
        }}>
          El % de descuento se calcula sobre el precio medio de anuncios nuevo/sin abrir en Wallapop y Vinted.
          Solo se incluyen artículos en estado nuevo, sin abrir o como nuevo con precio superior a 55€.
          ▲▼ indican movimiento respecto al ranking de la hora anterior.
        </p>
      </main>
    </div>
  )
}
