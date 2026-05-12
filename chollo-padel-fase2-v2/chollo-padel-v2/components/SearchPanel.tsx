'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import { WallapopItem } from '@/lib/wallapop'
import AlertModal from '@/components/AlertModal'

// Estados normalizados — valen para Wallapop y Vinted a la vez
const CONDITIONS = [
  { label: 'TODOS',       value: '' },
  { label: 'NUEVO',       value: 'new' },
  { label: 'COMO NUEVO',  value: 'as_good_as_new' },
  { label: 'BUEN ESTADO', value: 'good' },
  { label: 'ACEPTABLE',   value: 'fair' },
]

const CONDITION_LABEL: Record<string, string> = {
  new:            'NUEVO',
  as_good_as_new: 'COMO NUEVO',
  good:           'BUEN ESTADO',
  fair:           'ACEPTABLE',
  un_opened:      'SIN ABRIR',
  has_given_it_all: 'DADO TODO',
  'Nuevo con etiqueta': 'NUEVO',
  'Nuevo sin etiqueta': 'NUEVO',
  'Muy bueno':    'COMO NUEVO',
  'Bueno':        'BUEN ESTADO',
  'Satisfactorio': 'ACEPTABLE',
}

const PLATFORMS = [
  { label: 'WALLAPOP', value: 'wallapop' },
  { label: 'VINTED',   value: 'vinted' },
]

const SORT_OPTIONS = [
  { label: 'PRECIO: MENOR A MAYOR', value: 'price_asc' },
  { label: 'PRECIO: MAYOR A MENOR', value: 'price_desc' },
  { label: 'MÁS RECIENTES',         value: 'date_desc' },
]

const HISTORY_KEY = 'chollo_search_history'
const MAX_HISTORY = 20

function getHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') }
  catch { return [] }
}

function saveToHistory(q: string) {
  try {
    const prev = getHistory().filter(h => h.toLowerCase() !== q.toLowerCase())
    localStorage.setItem(HISTORY_KEY, JSON.stringify([q, ...prev].slice(0, MAX_HISTORY)))
  } catch {}
}

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

// ─── Modal Favorito ────────────────────────────────────────────────────────────

function FavoritoModal({ item, onClose }: { item: WallapopItem; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [maxPrice, setMaxPrice] = useState(String(item.price))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function guardar() {
    if (!email.trim()) { setError('El email es obligatorio'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'favorito',
          email: email.trim(),
          max_price: parseInt(maxPrice) || item.price,
          item_id: item.id,
          item_url: item.url,
          item_titulo: item.title,
          item_img: item.img,
        }),
      })
      if (!res.ok) throw new Error()
      setSaved(true)
      setTimeout(onClose, 1800)
    } catch {
      setError('Error al guardar. Inténtalo de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={modalStyles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modalStyles.modal}>
        <div style={modalStyles.title}>FAVORITO + ALERTA</div>
        <p style={modalStyles.subtitle}>Te avisamos si baja de precio</p>
        {saved ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 48 }}>⭐</div>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 2, marginTop: 12, color: '#C8FF00' }}>¡FAVORITO GUARDADO!</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, background: '#1a1a1a', padding: 12 }}>
              {item.img && (
                <img
                  src={item.platform === 'wallapop' ? `/api/img?url=${encodeURIComponent(item.img)}` : item.img}
                  width={60}
                  style={{ borderRadius: 4, objectFit: 'cover', height: 60 }}
                  alt={item.title}
                />
              )}
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#fff', lineHeight: 1.4 }}>{item.title}</p>
                <p style={{ margin: '6px 0 0', fontSize: 20, fontFamily: 'Bebas Neue, sans-serif', color: '#C8FF00' }}>{item.price}€</p>
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={modalStyles.label}>AVISARME SI BAJA DE (€)</label>
              <input
                style={modalStyles.input}
                type="number"
                value={maxPrice}
                onChange={e => setMaxPrice(e.target.value)}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={modalStyles.label}>TU EMAIL *</label>
              <input
                style={modalStyles.input}
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@email.com"
              />
            </div>
            {error && <div style={modalStyles.errorMsg}>{error}</div>}
            <div style={modalStyles.actions}>
              <button style={modalStyles.btnCancel} onClick={onClose}>CANCELAR</button>
              <button style={modalStyles.btnSave} onClick={guardar} disabled={saving}>
                {saving ? 'GUARDANDO...' : '⭐ GUARDAR →'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const modalStyles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#111', border: '1px solid rgba(255,255,255,0.1)', padding: 32, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' },
  title: { fontFamily: 'Bebas Neue, sans-serif', fontSize: 28, letterSpacing: 4, marginBottom: 6, color: '#fff' },
  subtitle: { color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 24 },
  label: { fontSize: 11, letterSpacing: 1.5, color: 'rgba(255,255,255,0.4)', fontFamily: 'Barlow Condensed, sans-serif', display: 'block' as const, marginBottom: 6 },
  input: { width: '100%', background: '#181818', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '10px 14px', fontSize: 14, outline: 'none', fontFamily: 'Barlow, sans-serif', boxSizing: 'border-box' as const },
  actions: { display: 'flex', gap: 12, marginTop: 24 },
  btnCancel: { flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)', padding: 12, fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13, letterSpacing: 2, cursor: 'pointer' },
  btnSave: { flex: 2, background: '#C8FF00', color: '#000', border: 'none', padding: 12, fontFamily: 'Barlow Condensed, sans-serif', fontSize: 14, fontWeight: 700, letterSpacing: 2, cursor: 'pointer' },
  errorMsg: { background: 'rgba(255,95,31,0.15)', border: '1px solid rgba(255,95,31,0.3)', color: '#FF5F1F', padding: '10px 14px', fontSize: 12, marginTop: 8 },
}

// ─── Card ──────────────────────────────────────────────────────────────────────

function Card({ item, onFavorito }: { item: WallapopItem; onFavorito: (item: WallapopItem) => void }) {
  const isChollo = item.price > 0 && item.price < 80
  const isVinted = item.platform === 'vinted'
  const borderColor = isVinted ? '#09B1BA' : '#C8FF00'
  return (
    <div style={{ ...styles.card, border: `1px solid ${borderColor}` }}>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
      >
        <div style={{ position: 'relative' }}>
          {item.img
            ? <img src={item.platform === 'wallapop' && item.img ? `/api/img?url=${encodeURIComponent(item.img)}` : item.img ?? ''} alt={item.title} style={styles.cardImg} loading="lazy" />
            : <div style={{ ...styles.cardImg, background: '#1a1a1a' }} />
          }
          {isChollo && <span style={styles.badgeChollo}>CHOLLO</span>}
          <span style={{
            ...styles.badgePlatform,
            color: borderColor,
            borderColor: isVinted ? 'rgba(9,177,186,0.3)' : 'rgba(200,255,0,0.2)',
          }}>
            ◈ {isVinted ? 'VINTED' : 'WALLAPOP'}
          </span>
        </div>
        <div style={styles.cardBody}>
          <p style={styles.cardTitle}>{item.title}</p>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8 }}>
            <span style={{ ...styles.cardPrice, color: borderColor }}>{item.price}€</span>
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
      {/* Botón favorito */}
      <button
        onClick={() => onFavorito(item)}
        style={styles.btnFavorito}
        title="Guardar como favorito y recibir alerta de bajada de precio"
      >
        ⭐ FAVORITO
      </button>
    </div>
  )
}

// ─── SearchPanel ───────────────────────────────────────────────────────────────

interface SearchPanelProps {
  onOpenModal?: (query?: string) => void
}

export default function SearchPanel({ onOpenModal }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [selectedConditions, setSelectedConditions] = useState<string[]>([])
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['wallapop', 'vinted'])
  const [sortBy, setSortBy] = useState('price_asc')
  const [results, setResults] = useState<WallapopItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)

  // Nuevos estados para alertas y favoritos
  const [showAlertModal, setShowAlertModal] = useState(false)
  const [favoritoItem, setFavoritoItem] = useState<WallapopItem | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) setShowSuggestions(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Leer ?q= de la URL al cargar (para "BUSCAR AHORA" desde Mis Alertas)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const q = params.get('q')
    if (q) {
      setQuery(q)
      doSearchWith(q)
    }
  }, [])

  function handleQueryChange(val: string) {
    setQuery(val)
    const history = getHistory()
    if (val.trim().length > 0) {
      const filtered = history.filter(h => h.toLowerCase().includes(val.toLowerCase()))
      setSuggestions(filtered.slice(0, 6))
      setShowSuggestions(filtered.length > 0)
    } else {
      setSuggestions(history.slice(0, 6))
      setShowSuggestions(history.length > 0)
    }
  }

  function handleInputFocus() {
    const history = getHistory()
    if (query.trim().length === 0 && history.length > 0) {
      setSuggestions(history.slice(0, 6))
      setShowSuggestions(true)
    }
  }

  function selectSuggestion(s: string) {
    setQuery(s)
    setShowSuggestions(false)
    setTimeout(() => doSearchWith(s), 0)
  }

  function toggleCondition(value: string) {
    if (value === '') { setSelectedConditions([]); return }
    setSelectedConditions(prev =>
      prev.includes(value) ? prev.filter(c => c !== value) : [...prev, value]
    )
  }

  function togglePlatform(value: string) {
    setSelectedPlatforms(prev => {
      if (prev.includes(value)) {
        if (prev.length === 1) return prev
        return prev.filter(p => p !== value)
      }
      return [...prev, value]
    })
  }

  async function doSearchWith(q: string) {
    if (!q.trim()) return
    setLoading(true)
    setError('')
    setResults([])
    setSearched(false)

    try {
      const params = new URLSearchParams({ q: q.trim() })
      if (minPrice) params.set('min_price', minPrice)
      if (maxPrice) params.set('max_price', maxPrice)
      if (selectedConditions.length > 0) params.set('conditions', selectedConditions.join(','))
      params.set('platforms', selectedPlatforms.join(','))

      const res = await fetch(`/api/search?${params.toString()}`)
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data: WallapopItem[] = await res.json()
      setResults(data)
      setSearched(true)
      saveToHistory(q.trim())

      fetch('/api/searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q.trim() }),
      }).catch(() => {})

    } catch (err) {
      setError('Error al buscar. Inténtalo de nuevo.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function doSearch() {
    setShowSuggestions(false)
    await doSearchWith(query)
  }

  const sortedResults = useMemo(() => {
    const arr = [...results]
    if (sortBy === 'price_asc') return arr.sort((a, b) => a.price - b.price)
    if (sortBy === 'price_desc') return arr.sort((a, b) => b.price - a.price)
    return arr.sort((a, b) => {
      if (!a.date) return 1
      if (!b.date) return -1
      return new Date(b.date).getTime() - new Date(a.date).getTime()
    })
  }, [results, sortBy])

  const chollos = results.filter(r => r.price > 0 && r.price < 80)
  const bestPrice = results.length > 0 ? Math.min(...results.map(r => r.price)) : null
  const avgPrice = results.length > 0 ? Math.round(results.reduce((a, r) => a + r.price, 0) / results.length) : null
  const wallapopCount = results.filter(r => r.platform === 'wallapop').length
  const vintedCount = results.filter(r => r.platform === 'vinted').length

  return (
    <main style={styles.main}>

      {/* Barra de búsqueda */}
      <div style={styles.searchBar}>
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            onFocus={handleInputFocus}
            onKeyDown={e => {
              if (e.key === 'Enter') { setShowSuggestions(false); doSearch() }
              if (e.key === 'Escape') setShowSuggestions(false)
            }}
            placeholder="Buscar pala, marca, modelo..."
            style={{ ...styles.input, width: '100%' }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div ref={suggestionsRef} style={styles.suggestions}>
              {suggestions.map((s, i) => (
                <div key={i} style={styles.suggestionItem} onMouseDown={() => selectSuggestion(s)}>
                  <span style={{ opacity: 0.4, marginRight: 8 }}>🕐</span>{s}
                </div>
              ))}
            </div>
          )}
        </div>
        <input
          type="number" value={minPrice}
          onChange={e => setMinPrice(e.target.value)}
          placeholder="Mín €"
          style={{ ...styles.input, width: 90, flex: 'none' }}
        />
        <input
          type="number" value={maxPrice}
          onChange={e => setMaxPrice(e.target.value)}
          placeholder="Máx €"
          style={{ ...styles.input, width: 90, flex: 'none' }}
        />
        <button onClick={doSearch} disabled={loading} style={styles.btnSearch}>
          {loading ? 'BUSCANDO…' : 'BUSCAR →'}
        </button>
        {searched && results.length > 0 && (
          <button onClick={() => setShowAlertModal(true)} style={styles.btnAlerta}>
            🔔 ALERTA
          </button>
        )}
      </div>

      {/* Toggles de plataforma */}
      <div style={styles.filtersRow}>
        <span style={styles.filterLabel}>PLATAFORMA:</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {PLATFORMS.map(p => {
            const active = selectedPlatforms.includes(p.value)
            const isVinted = p.value === 'vinted'
            return (
              <button
                key={p.value}
                onClick={() => togglePlatform(p.value)}
                style={{
                  ...styles.filterBtn,
                  ...(active ? {
                    background: isVinted ? '#09B1BA' : '#C8FF00',
                    border: `1px solid ${isVinted ? '#09B1BA' : '#C8FF00'}`,
                    color: '#000',
                  } : {}),
                }}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Filtros de estado */}
      <div style={styles.filtersRow}>
        <span style={styles.filterLabel}>ESTADO:</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CONDITIONS.map(c => {
            const active = c.value === '' ? selectedConditions.length === 0 : selectedConditions.includes(c.value)
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
            <div style={styles.statLabel}>Total</div>
          </div>
          <div style={styles.statBox}>
            <div style={{ ...styles.statValue, color: '#C8FF00' }}>{wallapopCount}</div>
            <div style={styles.statLabel}>Wallapop</div>
          </div>
          <div style={styles.statBox}>
            <div style={{ ...styles.statValue, color: '#09B1BA' }}>{vintedCount}</div>
            <div style={styles.statLabel}>Vinted</div>
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
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={styles.sortSelect}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}

      {/* Grid */}
      <div style={styles.grid}>
        {sortedResults.map(item => (
          <Card
            key={`${item.platform}-${item.id}`}
            item={item}
            onFavorito={setFavoritoItem}
          />
        ))}
      </div>

      {/* Sin resultados */}
      {searched && results.length === 0 && !loading && (
        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', marginTop: 64, fontSize: 14 }}>
          Sin resultados para "{query}"
        </p>
      )}

      {/* Modal alerta de búsqueda */}
      {showAlertModal && (
        <AlertModal
          prefillQuery={query}
          onClose={() => setShowAlertModal(false)}
        />
      )}

      {/* Modal favorito */}
      {favoritoItem && (
        <FavoritoModal
          item={favoritoItem}
          onClose={() => setFavoritoItem(null)}
        />
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
  btnAlerta: {
    background: 'transparent', border: '1px solid #C8FF00', color: '#C8FF00',
    padding: '10px 20px', fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 14, fontWeight: 700, letterSpacing: 2, cursor: 'pointer',
  },
  filtersRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' },
  filterLabel: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 11, letterSpacing: 2, color: 'rgba(255,255,255,0.35)' },
  filterBtn: {
    background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.6)', padding: '5px 14px',
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: 12,
    fontWeight: 600, letterSpacing: 1.5, cursor: 'pointer',
  },
  filterBtnActive: { background: '#C8FF00', border: '1px solid #C8FF00', color: '#000' },
  statsRow: { display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' },
  statBox: { background: '#111', border: '1px solid rgba(255,255,255,0.07)', padding: '14px 24px', minWidth: 90 },
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
    background: '#111',
    display: 'block', overflow: 'hidden',
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
    position: 'absolute', bottom: 8, left: 8, background: 'rgba(0,0,0,0.75)',
    fontSize: 9, fontWeight: 600, letterSpacing: 1, padding: '3px 8px',
    fontFamily: 'Barlow Condensed, sans-serif', border: '1px solid',
  },
  btnFavorito: {
    width: '100%', background: 'transparent', border: 'none',
    borderTop: '1px solid rgba(255,255,255,0.07)',
    color: 'rgba(255,255,255,0.35)', padding: '8px',
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: 10,
    letterSpacing: 1.5, cursor: 'pointer',
  },
  suggestions: {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
    background: '#181818', border: '1px solid rgba(255,255,255,0.1)', borderTop: 'none',
  },
  suggestionItem: {
    padding: '10px 16px', fontSize: 13, fontFamily: 'Barlow, sans-serif',
    color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
}
