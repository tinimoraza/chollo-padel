'use client'
import { useState, useEffect } from 'react'
import { WallapopItem } from '@/lib/wallapop'

const GOOD_CONDITIONS = new Set(['new', 'un_opened', 'as_good_as_new'])
const GOOD_CONDITIONS_CHOLLOS = new Set([
  'new', 'un_opened', 'as_good_as_new',
  'Nuevo con etiqueta', 'Nuevo sin etiqueta',
])

function getDiscountTag(price: number, precioRef: number | null, condition?: string) {
  if (!precioRef || precioRef <= 0 || price <= 0) return null
  const pct = (precioRef - price) / precioRef
  const isGoodCondition = !condition || GOOD_CONDITIONS.has(condition)
  if (pct >= 0.45 && isGoodCondition) return { label: 'CHOLLO',     emoji: '🔥', color: '#FF5F1F', pct }
  if (pct >= 0.30 && isGoodCondition) return { label: 'OFERTA',     emoji: '⚡', color: '#C8FF00', pct }
  if (pct >= 0.15 && isGoodCondition) return { label: 'BUEN PRECIO', emoji: '💸', color: '#09B1BA', pct }
  return null
}

const CONDITION_LABEL: Record<string, string> = {
  new: 'NUEVO', un_opened: 'SIN ABRIR', as_good_as_new: 'COMO NUEVO',
  good: 'BUEN ESTADO', fair: 'ACEPTABLE', has_given_it_all: 'DADO TODO',
  'Nuevo con etiquetas': 'NUEVO', 'Nuevo sin etiquetas': 'NUEVO',
  'Muy bueno': 'COMO NUEVO', 'Bueno': 'BUEN ESTADO', 'Satisfactorio': 'ACEPTABLE',
}

function ChollCard({ item }: { item: WallapopItem & { _tag: NonNullable<ReturnType<typeof getDiscountTag>> } }) {
  const { _tag } = item
  const descuentoPct = Math.round(_tag.pct * 100)
  const isVinted = item.platform === 'vinted'

  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" style={styles.card}>
      <div style={{ position: 'relative' }}>
        {item.img
          ? <img
              src={isVinted ? item.img : `/api/img?url=${encodeURIComponent(item.img)}`}
              alt={item.title}
              style={styles.cardImg}
              loading="lazy"
            />
          : <div style={{ ...styles.cardImg, background: '#1a1a1a' }} />
        }
        <span style={{ ...styles.badge, background: _tag.color, color: '#000' }}>
          {_tag.emoji} {_tag.label} -{descuentoPct}%
        </span>
        <span style={{ ...styles.platformBadge, color: isVinted ? '#09B1BA' : '#C8FF00' }}>
          ◈ {isVinted ? 'VINTED' : 'WALLAPOP'}
        </span>
      </div>
      <div style={styles.cardBody}>
        <p style={styles.cardTitle}>{item.title}</p>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8 }}>
          <div>
            <span style={{ ...styles.cardPrice, color: _tag.color }}>{item.price}€</span>
            {item.precio_referencia && (
              <span style={styles.precioRef}>{item.precio_referencia}€</span>
            )}
          </div>
          <div style={styles.cardMeta}>
            <div>{item.city || ''}</div>
          </div>
        </div>
        {item.condition && (
          <span style={styles.conditionBadge}>
            {CONDITION_LABEL[item.condition] ?? item.condition}
          </span>
        )}
      </div>
    </a>
  )
}

const TAGS = ['TODOS', 'CHOLLO', 'OFERTA', 'BUEN PRECIO']
const MARCAS = ['TODAS', 'Bullpadel', 'NOX', 'Head', 'Babolat', 'Adidas', 'Wilson', 'Siux', 'Dunlop', 'Varlion']

export default function ChollosPage() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tagFilter, setTagFilter] = useState('TODOS')
  const [marcaFilter, setMarcaFilter] = useState('TODAS')

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const marcas = ['bullpadel', 'nox', 'head', 'babolat', 'adidas', 'wilson', 'siux']
        const results = await Promise.all(
          marcas.map(m =>
            fetch(`/api/search?q=${m}&platforms=wallapop,vinted`)
              .then(r => r.json())
              .catch(() => [])
          )
        )
        const all: WallapopItem[] = []
        const seen = new Set<string>()
        for (const batch of results) {
          for (const item of batch) {
            const key = `${item.platform}-${item.id}`
            if (!seen.has(key)) {
              seen.add(key)
              all.push(item)
            }
          }
        }

        const withTag = all
          .filter(item => item.precio_referencia !== null)
          .filter(item => GOOD_CONDITIONS_CHOLLOS.has(item.condition))
          .filter(item => /202[0-9]/.test(item.title))
          .map(item => {
            const tag = getDiscountTag(item.price, item.precio_referencia, item.condition)
            return tag ? { ...item, _tag: tag } : null
          })
          .filter(Boolean)
          .sort((a: any, b: any) => b._tag.pct - a._tag.pct)

        setItems(withTag as any[])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = items.filter(item => {
    if (tagFilter !== 'TODOS' && item._tag.label !== tagFilter) return false
    if (marcaFilter !== 'TODAS') {
      if (!item.title.toLowerCase().includes(marcaFilter.toLowerCase())) return false
    }
    return true
  })

  return (
    <div className="app-shell">
      <header className="header">
        <a className="logo" href="/">
          <img src="/huntpadel-logo.svg" alt="HuntPadel" height={36} />
        </a>
        <nav className="nav">
          <a className="nav-link" href="/">BUSCADOR</a>
          <a className="nav-link" href="/palas">PALAS</a>
          <a className="nav-link" href="/alertas">MIS ALERTAS</a>
          <a className="nav-link active" href="/chollos" style={{ color: '#FF5F1F' }}>🔥 CHOLLOS</a>
        </nav>
        <a href="/alertas" className="btn-alert-top">+ NUEVA ALERTA</a>
      </header>

      <main style={styles.main}>
        <div style={styles.pageHeader}>
          <h1 style={styles.title}>🔥 CHOLLOS DEL DÍA</h1>
          <p style={styles.subtitle}>
            Palas nuevas o como nuevas con mayor descuento · Actualizadas cada hora
          </p>
        </div>

        <div style={styles.filtersRow}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TAGS.map(t => (
              <button
                key={t}
                onClick={() => setTagFilter(t)}
                style={{
                  ...styles.filterBtn,
                  ...(tagFilter === t ? {
                    background: t === 'CHOLLO' ? '#FF5F1F' : t === 'OFERTA' ? '#C8FF00' : t === 'BUEN PRECIO' ? '#09B1BA' : '#fff',
                    color: '#000',
                    border: '1px solid transparent',
                  } : {})
                }}
              >
                {t === 'CHOLLO' ? '🔥' : t === 'OFERTA' ? '⚡' : t === 'BUEN PRECIO' ? '💸' : ''} {t}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {MARCAS.map(m => (
              <button
                key={m}
                onClick={() => setMarcaFilter(m)}
                style={{
                  ...styles.filterBtn,
                  ...(marcaFilter === m ? { background: '#C8FF00', color: '#000', border: '1px solid transparent' } : {})
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {!loading && (
          <p style={styles.counter}>{filtered.length} chollos encontrados</p>
        )}

        {loading ? (
          <p style={styles.loading}>Buscando chollos...</p>
        ) : (
          <div style={styles.grid}>
            {filtered.map((item: any) => (
              <ChollCard key={`${item.platform}-${item.id}`} item={item} />
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <p style={styles.loading}>No hay chollos con estos filtros ahora mismo.</p>
        )}
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  main: { flex: 1, padding: '24px 28px', overflowY: 'auto', background: '#080808' },
  pageHeader: { marginBottom: 24 },
  title: { fontFamily: 'Bebas Neue, sans-serif', fontSize: 48, letterSpacing: 4, color: '#FF5F1F', margin: 0 },
  subtitle: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13, letterSpacing: 1, color: 'rgba(255,255,255,0.4)', marginTop: 6 },
  filtersRow: { marginBottom: 20 },
  filterBtn: {
    background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.6)', padding: '5px 14px',
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: 12,
    fontWeight: 600, letterSpacing: 1.5, cursor: 'pointer',
  },
  counter: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 12, letterSpacing: 1.5, color: 'rgba(255,255,255,0.35)', marginBottom: 16 },
  loading: { textAlign: 'center', color: 'rgba(255,255,255,0.3)', marginTop: 64, fontSize: 14 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 },
  card: { background: '#111', border: '1px solid rgba(255,95,31,0.3)', display: 'block', overflow: 'hidden', textDecoration: 'none', color: 'inherit' },
  cardImg: { width: '100%', height: 160, objectFit: 'cover', display: 'block' },
  cardBody: { padding: '10px 12px' },
  cardTitle: { fontSize: 12, fontWeight: 600, fontFamily: 'Barlow, sans-serif', lineHeight: 1.4, color: '#fff', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  cardPrice: { fontFamily: 'Bebas Neue, sans-serif', fontSize: 26, letterSpacing: 1 },
  precioRef: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 12, color: 'rgba(255,255,255,0.3)', textDecoration: 'line-through', marginLeft: 6, verticalAlign: 'middle' },
  cardMeta: { fontSize: 10, color: 'rgba(255,255,255,0.35)', textAlign: 'right', fontFamily: 'Barlow, sans-serif' },
  conditionBadge: { display: 'inline-block', marginTop: 8, background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 1, padding: '2px 8px' },
  badge: { position: 'absolute', top: 8, left: 8, fontSize: 9, fontWeight: 700, letterSpacing: 1.5, padding: '3px 8px', fontFamily: 'Barlow Condensed, sans-serif' },
  platformBadge: { position: 'absolute', bottom: 8, left: 8, background: 'rgba(0,0,0,0.75)', fontSize: 9, fontWeight: 600, letterSpacing: 1, padding: '3px 8px', fontFamily: 'Barlow Condensed, sans-serif', border: '1px solid rgba(255,255,255,0.15)' },
}