'use client'
import { useState, useMemo } from 'react'
import { WallapopItem } from '@/lib/wallapop'

const CONDITIONS = [
  { label: 'TODOS', value: '' },
  { label: 'SIN ABRIR', value: 'un_opened' },
  { label: 'NUEVO', value: 'new' },
  { label: 'COMO NUEVO', value: 'as_good_as_new' },
  { label: 'BUEN ESTADO', value: 'good' },
  { label: 'ACEPTABLE', value: 'fair' },
  { label: 'DADO TODO', value: 'has_given_it_all' },
]

const CONDITION_LABEL: Record<string, string> = {
  un_opened: 'SIN ABRIR',
  new: 'NUEVO',
  as_good_as_new: 'COMO NUEVO',
  good: 'BUEN ESTADO',
  fair: 'ACEPTABLE',
  has_given_it_all: 'DADO TODO',
}

const SORT_OPTIONS = [
  { label: 'MÁS RECIENTES', value: 'date_desc' },
  { label: 'PRECIO: MENOR A MAYOR', value: 'price_asc' },
  { label: 'PRECIO: MAYOR A MENOR', value: 'price_desc' },
]

function formatDate(dateStr: string) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return '' }
}

function prettyCondition(value?: string) {
  if (!value) return ''
  return CONDITION_LABEL[value] ?? value
}

function Card({ item }: { item: WallapopItem }) {
  const isChollo = item.price > 0 && item.price < 80
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" style={styles.card}>
      <div style={{ position: 'relative' }}>
        {item.img
          ? <img src={item.img} alt={item.title} style={styles.cardImg} loading="lazy" />
          : <div style={{ ...styles.cardImg, background: '#1a1a1a' }} />
        }
        {isChollo && <span style={styles.badgeChollo}>CHOLLO</span>}
        <span style={styles.badgePlatform}>● WALLAPOP</span>
      </div>
      <div style={styles.cardBody}>
        <p style={styles.cardTitle}>{item.title}</p>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8 }}>
          <span style={styles.cardPrice}>{item.price}€</span>
          <div style={styles.cardMeta}>
            <div>{item.city || item.location || ''}</div>
            {item.date && <div>{formatDate(item.date)}</div>}
          </div>
        </div>
        {item.condition && (
          <span style={styles.conditionBadge}>{prettyCondition(item.condition)}</span>
        )}
      </div>
    </a>
  )
}

interface SearchPanelProps {
  onOpenModal?: (query?: string) => void
}

export default function SearchPanel({ onOpenModal }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [selectedConditions, setSelectedConditions] = useState<string[]>([])
  const [sortBy, setSortBy] = useState('date_desc')
  const [results, setResults] = useState<WallapopItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)

  function toggleCondition(value: string) {
    if (value === '') {
      setSelectedConditions([])
      return
    }
    setSelectedConditions(prev =>
      prev.includes(value) ? prev.filter(c => c !== value) : [...prev, value]
    )
  }

  async function doSearch() {
    if (!query.trim()) return
    setLoading(true)
    setError('')
    setResults([])
    setSearched(false)

    try {
      const params = new URLSearchParams({ q: query.trim() })
      if (minPrice) params.set('min_price', minPrice)
      if (maxPrice) params.set('max_price', maxPrice)
      if (selectedConditions.length > 0) params.set('conditions', selectedConditions.join(','))

      const res = await fetch(`/api/search?${params.toString()}`)
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data: WallapopItem[] = await res.json()
      setResults(data)
      setSearched(true)
    } catch (err) {
      setError('Error al buscar. Inténtalo de nuevo.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const sortedResults = useMemo(() => {
    const arr = [...results]
    if (sortBy === 'price_asc') return arr.sort((a, b) => a.price - b.price)
    if (sortBy === 'price_desc') return arr.sort((a, b) => b.price - a.price)
    // date_desc: más recientes primero
    return arr.sort((a, b) => {
      if (!a.date) return 1
      if (!b.date) return -1
      return new Date(b.date).getTime() - new Date(a.date).getTime()
    })
  }, [results, sortBy])

  const chollos = results.filter(r => r.price > 0 && r.price < 80)
  const bestPrice = results.length > 0 ? Math.min(...results.map(r => r.price)) : null
  const avgPrice = results.length > 0 ? Math.round(results.reduce((a, r) => a + r.price, 0) / results.length) : null

  return (
    <main style={styles.main}>
      {/* Barra de búsqueda */}
      <div style={styles.searchBar}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder="Buscar pala, marca, modelo..."
          style={styles.input}
        />
        <input
          type="number"
          value={minPrice}
          onChange={e => setMinPrice(e.target.value)}
          placeholder="Mín €"
          style={{ ...styles.input, width: 90, flex: 'none' }}
        />
        <input
          type="number"
          value={maxPrice}
          onChange={e => setMaxPrice(e.target.value)}
          placeholder="Máx €"
          style={{ ...styles.input, width: 90, flex: 'none' }}
        />
        <button onClick={doSearch} disabled={loading} style={styles.btnSearch}>
          {loading ? 'BUSCANDO…' : 'BUSCAR →'}
        </button>
      </div>

      {/* Filtros de estado */}
      <div style={styles.filtersRow}>
        <span style={styles.filterLabel}>Estado:</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CONDITIONS.map(c => {
            const active = c.value === ''
              ? selectedConditions.length === 0
              : selectedConditions.includes(c.value)
            return (
              <button
                key={c.value}
                onClick={() => toggleCondition(c.value)}
                style={{ ...styles.filterBtn, ...(active ? styles.filterBtnActive : {}) }}
              >
                {c.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Stats */}
      {searched && results.length > 0 && (
        <div style={styles.statsRow}>
          <div style={styles.statBox}>
            <div style={styles.statValue}>{results.length}</div>
            <div style={styles.statLabel}>Resultados</div>
          </div>
          <div style={styles.statBox}>
            <div style={{ ...styles.statValue, color: '#FF5F1F' }}>{bestPrice}€</div>
            <div style={styles.statLabel}>Mejor precio</div>
          </div>
          <div style={styles.statBox}>
            <div style={styles.statValue}>{avgPrice}€</div>
            <div style={styles.statLabel}>Precio medio</div>
          </div>
          <div style={styles.statBox}>
            <div style={{ ...styles.statValue, color: '#FF5F1F' }}>{chollos.length}</div>
            <div style={styles.statLabel}>Chollos &lt;80€</div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && <p style={{ color: '#FF5F1F', fontSize: 13, marginBottom: 16 }}>{error}</p>}

      {/* Contador + Ordenar */}
      {searched && results.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <p style={styles.resultCount}>
            {results.length} resultado{results.length !== 1 ? 's' : ''} · "{query.toUpperCase()}"
          </p>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            style={styles.sortSelect}
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Grid */}
      <div style={styles.grid}>
        {sortedResults.map(item => <Card key={item.id} item={item} />)}
      </div>

      {/* Sin resultados */}
      {searched && results.length === 0 && !loading && (
        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', marginTop: 64, fontSize: 14 }}>
          Sin resultados para "{query}"
        </p>
      )}
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  main: { flex: 1, padding: '24px 28px', overflowY: 'auto', background: '#080808' },
  searchBar: { display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  input: {
    flex: 1, background: '#111', border: '1px solid rgba(255,255,255,0.1)',
    color: '#fff', padding: '10px 16px', fontSize: 14, outline: 'none',
    fontFamily: 'Barlow, sans-serif', minWidth: 0,
  },
  btnSearch: {
    background: '#C8FF00', color: '#000', border: 'none',
    padding: '10px 28px', fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 14, fontWeight: 700, letterSpacing: 2, cursor: 'pointer',
  },
  filtersRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
  filterLabel: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 11, letterSpacing: 2, color: 'rgba(255,255,255,0.35)' },
  filterBtn: {
    background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.6)', padding: '5px 14px',
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: 12,
    fontWeight: 600, letterSpacing: 1.5, cursor: 'pointer',
  },
  filterBtnActive: {
    background: '#C8FF00', border: '1px solid #C8FF00', color: '#000',
  },
  statsRow: { display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' },
  statBox: {
    background: '#111', border: '1px solid rgba(255,255,255,0.07)',
    padding: '14px 24px', minWidth: 110,
  },
  statValue: { fontFamily: 'Bebas Neue, sans-serif', fontSize: 28, letterSpacing: 2, color: '#C8FF00', lineHeight: 1 },
  statLabel: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 11, letterSpacing: 1.5, color: 'rgba(255,255,255,0.35)', marginTop: 4 },
  resultCount: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 12, letterSpacing: 1.5, color: 'rgba(255,255,255,0.35)', margin: 0 },
  sortSelect: {
    background: '#111', border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.7)', padding: '6px 12px',
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: 12,
    fontWeight: 600, letterSpacing: 1.5, cursor: 'pointer', outline: 'none',
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 },
  card: {
    background: '#111', border: '1px solid rgba(255,255,255,0.07)',
    display: 'block', textDecoration: 'none', color: 'inherit',
    overflow: 'hidden',
  },
  cardImg: { width: '100%', height: 160, objectFit: 'cover', display: 'block' },
  cardBody: { padding: '10px 12px' },
  cardTitle: {
    fontSize: 12, fontWeight: 600, fontFamily: 'Barlow, sans-serif',
    lineHeight: 1.4, color: '#fff',
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  cardPrice: { fontFamily: 'Bebas Neue, sans-serif', fontSize: 26, letterSpacing: 1, color: '#C8FF00' },
  cardMeta: { fontSize: 10, color: 'rgba(255,255,255,0.35)', textAlign: 'right', fontFamily: 'Barlow, sans-serif', lineHeight: 1.5 },
  conditionBadge: {
    display: 'inline-block', marginTop: 8, background: '#1a1a1a',
    border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)',
    fontSize: 10, fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 1, padding: '2px 8px',
  },
  badgeChollo: {
    position: 'absolute', top: 8, left: 8, background: '#FF5F1F', color: '#000',
    fontSize: 9, fontWeight: 700, letterSpacing: 1.5, padding: '3px 8px',
    fontFamily: 'Barlow Condensed, sans-serif',
  },
  badgePlatform: {
    position: 'absolute', bottom: 8, left: 8, background: 'rgba(0,0,0,0.75)', color: '#C8FF00',
    fontSize: 9, fontWeight: 600, letterSpacing: 1, padding: '3px 8px',
    fontFamily: 'Barlow Condensed, sans-serif', border: '1px solid rgba(200,255,0,0.2)',
  },
}
