'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface Pala {
  id: number
  brand: string
  name: string
  image_url: string
  price: number
  shape: string
  balance: string
  level: string
  core: string
  face: string
  frame: string
  weight_min: number
  weight_max: number
  power: number
  control: number
  maneuverability: number
  sweet_spot: number
  slug: string
}

interface Filters {
  brand: string
  shape: string
  balance: string
  level: string
  onlyChollos: boolean
}

const SHAPES = ['Redonda', 'Diamante', 'Lágrima']
const BALANCES = ['Alto', 'Medio', 'Bajo']
const LEVELS = ['Iniciación', 'Intermedio', 'Avanzado', 'Competición']

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: 'rgba(255,255,255,0.5)', fontFamily: "'Barlow Condensed', sans-serif", textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontSize: 11, color: '#C8FF00', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>{value}/10</span>
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${(value / 10) * 100}%`, background: 'linear-gradient(90deg, #C8FF00, #8FCC00)', borderRadius: 2, transition: 'width 0.6s ease' }} />
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
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', fontFamily: "'Barlow', sans-serif", minWidth: 56 }}>{label}:</span>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', fontFamily: "'Barlow', sans-serif" }}>{value}</span>
    </div>
  )
}

function ChollosSection({ pala }: { pala: Pala }) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const searchQuery = `${pala.brand} ${pala.name}`.trim()
    fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&platforms=wallapop,vinted`)
      .then(r => r.json())
      .then(data => {
        setItems(Array.isArray(data) ? data.slice(0, 6) : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [pala.brand, pala.name])

  if (loading) {
    return (
      <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, fontFamily: "'Barlow', sans-serif" }}>
        Buscando chollos...
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, fontFamily: "'Barlow', sans-serif" }}>
        Sin chollos activos ahora mismo.
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
      {items.map(item => {
        const saving = pala.price > 0 ? Math.round(((pala.price - item.price) / pala.price) * 100) : 0
        return (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: '#161616', border: '1px solid rgba(255,255,255,0.07)',
              padding: '12px', textDecoration: 'none', color: 'inherit',
              display: 'block', transition: 'border-color 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(200,255,0,0.25)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: '#C8FF00' }}>
                {item.price.toFixed(0)} €
              </span>
              {saving > 0 && (
                <span style={{
                  background: 'rgba(200,255,0,0.15)', color: '#C8FF00',
                  fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11,
                  letterSpacing: 1, padding: '2px 6px',
                }}>-{saving}%</span>
              )}
            </div>
            <div style={{
              fontSize: 12, color: 'rgba(255,255,255,0.6)', fontFamily: "'Barlow', sans-serif",
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6,
            }}>{item.title}</div>
            <div style={{
              fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
              color: item.platform === 'vinted' ? '#9B6BFF' : '#FF5F1F',
              fontFamily: "'Barlow Condensed', sans-serif",
            }}>{item.platform}</div>
          </a>
        )
      })}
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
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem', backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#111', border: '1px solid rgba(200,255,0,0.15)',
          width: '100%', maxWidth: 760, maxHeight: '90vh', overflowY: 'auto',
          position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 16, right: 16, background: 'none',
            border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)',
            width: 32, height: 32, cursor: 'pointer', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'monospace',
          }}
        >✕</button>

        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 0 }}>
          <div style={{
            background: '#0a0a0a', display: 'flex', alignItems: 'center',
            justifyContent: 'center', padding: '2rem', borderRight: '1px solid rgba(255,255,255,0.07)',
          }}>
            {pala.image_url
              ? <img src={pala.image_url} alt={pala.name} style={{ maxWidth: '100%', maxHeight: 280, objectFit: 'contain' }} />
              : <div style={{ fontSize: 64 }}>🏓</div>
            }
          </div>

          <div style={{ padding: '2rem' }}>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11,
              letterSpacing: 3, color: '#C8FF00', marginBottom: 6, textTransform: 'uppercase',
            }}>{pala.brand}</div>
            <h2 style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 28,
              letterSpacing: 2, marginBottom: 12, lineHeight: 1.1,
            }}>{pala.name}</h2>

            {pala.price > 0 && (
              <div style={{
                fontFamily: "'Bebas Neue', sans-serif", fontSize: 22,
                color: '#C8FF00', marginBottom: 16,
              }}>
                {pala.price.toFixed(2)} €
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: "'Barlow', sans-serif", marginLeft: 6 }}>PVP</span>
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
              {pala.shape && <Tag>{pala.shape}</Tag>}
              {pala.balance && <Tag>{pala.balance}</Tag>}
              {pala.level && <Tag accent>{pala.level}</Tag>}
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 16, marginBottom: 16 }}>
              <div style={{
                fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11,
                letterSpacing: 2, color: 'rgba(255,255,255,0.35)', marginBottom: 10, textTransform: 'uppercase',
              }}>Características técnicas</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                {pala.core && <TechRow label="Núcleo" value={pala.core} />}
                {pala.face && <TechRow label="Cara" value={pala.face} />}
                {pala.frame && <TechRow label="Marco" value={pala.frame} />}
                {(pala.weight_min || pala.weight_max) && (
                  <TechRow
                    label="Peso"
                    value={pala.weight_min && pala.weight_max
                      ? `${pala.weight_min}–${pala.weight_max}g`
                      : `${pala.weight_min || pala.weight_max}g`}
                  />
                )}
              </div>
            </div>

            {(pala.power > 0 || pala.control > 0 || pala.maneuverability > 0 || pala.sweet_spot > 0) && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 16 }}>
                <div style={{
                  fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11,
                  letterSpacing: 2, color: 'rgba(255,255,255,0.35)', marginBottom: 12, textTransform: 'uppercase',
                }}>Rendimiento</div>
                {pala.power > 0 && <StatBar label="Potencia" value={pala.power} />}
                {pala.control > 0 && <StatBar label="Control" value={pala.control} />}
                {pala.maneuverability > 0 && <StatBar label="Manejabilidad" value={pala.maneuverability} />}
                {pala.sweet_spot > 0 && <StatBar label="Punto dulce" value={pala.sweet_spot} />}
              </div>
            )}
          </div>
        </div>

        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.07)',
          padding: '1.5rem 2rem',
          background: '#0D0D0D',
        }}>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11,
            letterSpacing: 3, color: 'rgba(255,255,255,0.35)', marginBottom: 12, textTransform: 'uppercase',
          }}>Chollos activos en segunda mano</div>
          <ChollosSection pala={pala} />
        </div>
      </div>
    </div>
  )
}

function PalaCard({ pala, onClick }: { pala: Pala; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? '#161616' : '#111',
        border: `1px solid ${hovered ? 'rgba(200,255,0,0.2)' : 'rgba(255,255,255,0.07)'}`,
        cursor: 'pointer', transition: 'all 0.2s', display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{
        background: '#0A0A0A', height: 180,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden', padding: '1rem',
      }}>
        {pala.image_url
          ? <img src={pala.image_url} alt={pala.name} style={{ maxHeight: 160, maxWidth: '100%', objectFit: 'contain', transition: 'transform 0.3s', transform: hovered ? 'scale(1.05)' : 'scale(1)' }} />
          : <span style={{ fontSize: 48 }}>🏓</span>
        }
      </div>

      <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10,
          letterSpacing: 2, color: '#C8FF00', marginBottom: 4, textTransform: 'uppercase',
        }}>{pala.brand}</div>
        <div style={{
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 17,
          letterSpacing: 1, lineHeight: 1.2, marginBottom: 10, flex: 1,
        }}>{pala.name}</div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
          {pala.shape && (
            <span style={{
              fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10,
              letterSpacing: 1, textTransform: 'uppercase',
              padding: '2px 7px', border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.45)',
            }}>{pala.shape}</span>
          )}
          {pala.balance && (
            <span style={{
              fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10,
              letterSpacing: 1, textTransform: 'uppercase',
              padding: '2px 7px', border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.45)',
            }}>{pala.balance}</span>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {pala.price > 0 && (
            <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20 }}>
              {pala.price.toFixed(0)} €
            </span>
          )}
          <span style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10,
            letterSpacing: 1, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase',
          }}>Ver chollos →</span>
        </div>
      </div>
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11,
        letterSpacing: 2.5, color: 'rgba(255,255,255,0.35)', marginBottom: 10,
        textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 6,
      }}>{label}</div>
      {children}
    </div>
  )
}

function Pills({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(value === opt ? '' : opt)}
          style={{
            background: value === opt ? 'rgba(200,255,0,0.12)' : 'none',
            border: `1px solid ${value === opt ? 'rgba(200,255,0,0.4)' : 'rgba(255,255,255,0.12)'}`,
            color: value === opt ? '#C8FF00' : 'rgba(255,255,255,0.5)',
            fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11,
            letterSpacing: 1.5, textTransform: 'uppercase', padding: '5px 10px',
            cursor: 'pointer', transition: 'all 0.15s',
          }}
        >{opt}</button>
      ))}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  width: '100%', background: '#161616', border: '1px solid rgba(255,255,255,0.1)',
  color: '#fff', fontFamily: "'Barlow', sans-serif", fontSize: 13,
  padding: '8px 10px', cursor: 'pointer', outline: 'none',
}

function FilterSidebar({ filters, setFilters, brands, total }: {
  filters: Filters
  setFilters: (f: Filters) => void
  brands: string[]
  total: number
}) {
  function update(key: keyof Filters, value: any) {
    setFilters({ ...filters, [key]: value })
  }

  return (
    <aside style={{
      background: '#0F0F0F', borderRight: '1px solid rgba(255,255,255,0.07)',
      padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem',
      position: 'sticky', top: 54, height: 'calc(100vh - 54px)', overflowY: 'auto',
    }}>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 3, marginBottom: 4 }}>FILTROS</div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: 1 }}>{total} palas</div>
      </div>

      <button
        onClick={() => setFilters({ brand: '', shape: '', balance: '', level: '', onlyChollos: false })}
        style={{
          background: 'none', border: '1px solid rgba(255,255,255,0.1)',
          color: 'rgba(255,255,255,0.4)', fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 11, letterSpacing: 2, padding: '8px', cursor: 'pointer', textTransform: 'uppercase',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(200,255,0,0.3)'; e.currentTarget.style.color = '#C8FF00' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)' }}
      >Limpiar filtros</button>

      <div
        style={{
          padding: '12px 14px',
          background: filters.onlyChollos ? 'rgba(200,255,0,0.08)' : '#161616',
          border: `1px solid ${filters.onlyChollos ? 'rgba(200,255,0,0.3)' : 'rgba(255,255,255,0.07)'}`,
          cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 10,
        }}
        onClick={() => update('onlyChollos', !filters.onlyChollos)}
      >
        <div style={{
          width: 32, height: 18, background: filters.onlyChollos ? '#C8FF00' : 'rgba(255,255,255,0.1)',
          borderRadius: 9, position: 'relative', transition: 'background 0.2s', flexShrink: 0,
        }}>
          <div style={{
            position: 'absolute', top: 2, left: filters.onlyChollos ? 16 : 2,
            width: 14, height: 14, background: filters.onlyChollos ? '#000' : 'rgba(255,255,255,0.4)',
            borderRadius: '50%', transition: 'left 0.2s',
          }} />
        </div>
        <span style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12,
          letterSpacing: 1.5, textTransform: 'uppercase',
          color: filters.onlyChollos ? '#C8FF00' : 'rgba(255,255,255,0.5)',
        }}>Solo con chollos</span>
      </div>

      <FilterGroup label="Marca">
        <select value={filters.brand} onChange={e => update('brand', e.target.value)} style={selectStyle}>
          <option value="">Todas</option>
          {brands.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </FilterGroup>

      <FilterGroup label="Forma">
        <Pills options={SHAPES} value={filters.shape} onChange={v => update('shape', v)} />
      </FilterGroup>

      <FilterGroup label="Balance">
        <Pills options={BALANCES} value={filters.balance} onChange={v => update('balance', v)} />
      </FilterGroup>

      <FilterGroup label="Nivel">
        <Pills options={LEVELS} value={filters.level} onChange={v => update('level', v)} />
      </FilterGroup>
    </aside>
  )
}

export default function PalasPage() {
  const [palas, setPalas] = useState<Pala[]>([])
  const [loading, setLoading] = useState(true)
  const [brands, setBrands] = useState<string[]>([])
  const [filters, setFilters] = useState<Filters>({ brand: '', shape: '', balance: '', level: '', onlyChollos: false })
  const [selected, setSelected] = useState<Pala | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('palas')
        .select('*')
        .order('brand', { ascending: true })
      if (error) { console.error(error); setLoading(false); return }
      const list = (data ?? []) as Pala[]
      setPalas(list)
      const uniqueBrands = Array.from(new Set(list.map(p => p.brand).filter(Boolean))).sort()
      setBrands(uniqueBrands)
      setLoading(false)
    }
    load()
  }, [])

  const filtered = palas.filter(p => {
    if (filters.brand && p.brand !== filters.brand) return false
    if (filters.shape && p.shape?.toLowerCase() !== filters.shape.toLowerCase()) return false
    if (filters.balance && p.balance?.toLowerCase() !== filters.balance.toLowerCase()) return false
    if (filters.level && p.level?.toLowerCase() !== filters.level.toLowerCase()) return false
    if (search) {
      const q = search.toLowerCase()
      if (!p.brand?.toLowerCase().includes(q) && !p.name?.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <>
      <style>{pageStyles}</style>
      <div className="app-shell">
        <header className="header">
          <a className="logo" href="/">
            <span className="logo-mark">🏓</span>
            CHOLLO PADEL
          </a>
          <nav className="nav">
            <a className="nav-link" href="/">BUSCADOR</a>
            <a className="nav-link active" href="/palas">PALAS</a>
            <a className="nav-link" href="#">MIS ALERTAS</a>
          </nav>
        </header>

        <div className="layout">
          <FilterSidebar filters={filters} setFilters={setFilters} brands={brands} total={filtered.length} />

          <main style={{ padding: '2rem', minHeight: 'calc(100vh - 54px)', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, letterSpacing: 4, marginBottom: 2 }}>CATÁLOGO DE PALAS</h1>
                <p style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, color: 'rgba(255,255,255,0.4)', letterSpacing: 1 }}>
                  {filtered.length} palas · haz clic para ver chollos activos
                </p>
              </div>
              <input
                type="text"
                placeholder="Buscar marca o modelo..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  background: '#111', border: '1px solid rgba(255,255,255,0.1)',
                  color: '#fff', fontFamily: "'Barlow', sans-serif", fontSize: 14,
                  padding: '10px 16px', outline: 'none', width: 280,
                }}
                onFocus={e => (e.target.style.borderColor = 'rgba(200,255,0,0.3)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
              />
            </div>

            {loading ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: 300, color: 'rgba(255,255,255,0.3)',
                fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, letterSpacing: 3,
              }}>CARGANDO PALAS...</div>
            ) : filtered.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: 300, gap: 12,
              }}>
                <div style={{ fontSize: 48 }}>🔍</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, letterSpacing: 2, color: 'rgba(255,255,255,0.4)' }}>SIN RESULTADOS</div>
              </div>
            ) : (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '1px', background: 'rgba(255,255,255,0.05)',
              }}>
                {filtered.map(pala => (
                  <div key={pala.id} style={{ background: '#080808' }}>
                    <PalaCard pala={pala} onClick={() => setSelected(pala)} />
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>

      {selected && <PalaModal pala={selected} onClose={() => setSelected(null)} />}
    </>
  )
}

const pageStyles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --neon: #C8FF00; --orange: #FF5F1F; --dark: #080808;
    --dark2: #0F0F0F; --dark3: #181818; --dark4: #222222;
    --border: rgba(255,255,255,0.07); --text: #FFFFFF; --muted: rgba(255,255,255,0.4);
  }
  html { scroll-behavior: smooth; }
  body {
    background: var(--dark); color: var(--text);
    font-family: 'Barlow', Arial, sans-serif; min-height: 100vh; overflow-x: hidden;
  }
  body::before {
    content: ''; position: fixed; inset: 0;
    background: repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px);
    pointer-events: none; z-index: 9999;
  }
  .app-shell { min-height: 100vh; }
  .header {
    background: var(--dark2); border-bottom: 1px solid var(--border);
    padding: 0 2rem; display: flex; align-items: center;
    justify-content: space-between; height: 54px; position: sticky; top: 0; z-index: 100;
  }
  .logo { font-family: 'Bebas Neue', sans-serif; font-size: 24px; letter-spacing: 3px;
    display: flex; align-items: center; gap: 12px; text-decoration: none; color: inherit; }
  .logo-mark { font-size: 20px; }
  .nav { display: flex; gap: 0; }
  .nav-link { padding: 0 20px; height: 54px; display: flex; align-items: center;
    font-family: 'Barlow Condensed', sans-serif; font-size: 13px; font-weight: 600;
    letter-spacing: 2px; color: var(--muted); text-decoration: none;
    border-bottom: 2px solid transparent; transition: all 0.2s; }
  .nav-link:hover, .nav-link.active { color: var(--text); border-bottom-color: var(--neon); }
  .layout { display: grid; grid-template-columns: 260px 1fr; min-height: calc(100vh - 54px); }
  @media (max-width: 768px) { .layout { grid-template-columns: 1fr; } }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: #080808; }
  ::-webkit-scrollbar-thumb { background: rgba(200,255,0,0.2); }
`
