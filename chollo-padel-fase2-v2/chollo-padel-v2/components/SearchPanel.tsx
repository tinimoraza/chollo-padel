'use client'
import { useState } from 'react'

interface PalaItem {
  id: string; title: string; price: number; city: string
  condition: string; platform: string; url: string; img: string | null; date: string
}

interface Stats { total: number; best: number | null; avg: number | null; chollos: number }

const CONDITIONS = [
  { label: 'SIN ABRIR',   matches: ['sin abrir', 'sinabrir', 'unopened'] },
  { label: 'NUEVO',       matches: ['nuevo', 'new'] },
  { label: 'COMO NUEVO',  matches: ['como nuevo', 'comonuevo', 'as_good_as_new', 'almost_new'] },
  { label: 'BUEN ESTADO', matches: ['buen estado', 'buenestado', 'good'] },
  { label: 'ACEPTABLE',   matches: ['aceptable', 'fair', 'condiciones aceptables'] },
  { label: 'DADO TODO',   matches: ['dado todo', 'poor', 'ha dado todo'] },
]

function matchesCondition(itemCondition: string, selected: string[]): boolean {
  if (selected.length === 0) return true
  const cond = itemCondition?.toLowerCase().replace(/\s+/g, ' ').trim() ?? ''
  return selected.some(label => {
    const def = CONDITIONS.find(c => c.label === label)
    return def ? def.matches.some(m => cond.includes(m)) : false
  })
}

export default function SearchPanel({ onOpenModal }: { onOpenModal: (q: string) => void }) {
  const [query, setQuery] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [condFilters, setCondFilters] = useState<string[]>([])
  const [srcFilter, setSrcFilter] = useState('all')
  const [sort, setSort] = useState('price_asc')
  const [results, setResults] = useState<PalaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [stats, setStats] = useState<Stats>({ total: 0, best: null, avg: null, chollos: 0 })

  async function doSearch(q?: string) {
    const term = q ?? query
    if (!term.trim()) return
    setQuery(term)
    setLoading(true)
    setSearched(true)

    try {
      const params = new URLSearchParams({ q: term })
      if (minPrice) params.append('min_price', minPrice)
      if (maxPrice) params.append('max_price', maxPrice)
      const res = await fetch(`/api/search?${params}`)
      const data = await res.json()
      setResults(data.items || [])
      calcStats(data.items || [])

      // DEBUG TEMPORAL - borrar después
      const uniqueConditions = [...new Set((data.items || []).map((i: any) => i.condition))]
      console.log('CONDITIONS EN RESULTADOS:', uniqueConditions)

    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  function toggleCond(label: string) {
    setCondFilters(prev =>
      prev.includes(label) ? prev.filter(c => c !== label) : [...prev, label]
    )
  }

  function calcStats(items: PalaItem[]) {
    const prices = items.map(i => i.price).filter(p => p > 0)
    setStats({
      total: items.length,
      best: prices.length ? Math.min(...prices) : null,
      avg: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
      chollos: prices.filter(p => p < 80).length,
    })
  }

  function filtered() {
    let items = [...results]
    items = items.filter(i => matchesCondition(i.condition, condFilters))
    if (srcFilter !== 'all') items = items.filter(i => i.platform === srcFilter)
    if (sort === 'price_asc') items.sort((a, b) => a.price - b.price)
    else if (sort === 'price_desc') items.sort((a, b) => b.price - a.price)
    else items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    return items
  }

  const items = filtered()

  return (
    <main style={styles.main}>
      <div style={styles.searchBar}>
        <div style={styles.searchRow}>
          <input
            style={styles.qInput}
            placeholder="Busca por marca, modelo... (ej: Bullpadel Hack 03)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
          />
          <input
            style={styles.priceInput}
            type="number"
            placeholder="Mín €"
            value={minPrice}
            onChange={e => setMinPrice(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
          />
          <span style={styles.priceSep}>—</span>
          <input
            style={styles.priceInput}
            type="number"
            placeholder="Máx €"
            value={maxPrice}
            onChange={e => setMaxPrice(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
          />
          <button style={styles.btnSearch} onClick={() => doSearch()}>
            BUSCAR →
          </button>
        </div>

        <div style={styles.chips}>
          <span style={styles.chipLabel}>Estado:</span>
          {CONDITIONS.map(({ label }) => (
            <button
              key={label}
              style={{ ...styles.chip, ...(condFilters.includes(label) ? styles.chipOn : {}) }}
              onClick={() => toggleCond(label)}
            >{label}</button>
          ))}
          <span style={{ ...styles.chipLabel, marginLeft: 16 }}>Plataforma:</span>
          {([['all', 'TODAS'], ['wallapop', 'WALLAPOP'], ['vinted', 'VINTED']] as [string, string][]).map(([val, label]) => (
            <button
              key={val}
              style={{ ...styles.chip, ...(srcFilter === val ? styles.chipOn : {}) }}
              onClick={() => setSrcFilter(val)}
            >{label}</button>
          ))}
        </div>

        {searched && (
          <div style={styles.statsRow}>
            <StatPill label="Resultados" value={items.length || '—'} color="#C8FF00" />
            <StatPill label="Mejor precio" value={stats.best ? `${stats.best}€` : '—'} color="#FF5F1F" />
            <StatPill label="Precio medio" value={stats.avg ? `${stats.avg}€` : '—'} color="#fff" />
            <StatPill label="Chollos <80€" value={stats.chollos || '—'} color="#FF5F1F" />
          </div>
        )}
      </div>

      <div style={styles.resultsArea}>
        {loading && <Loader />}
        {!loading && !searched && <EmptyState emoji="🎾" title="LISTA PARA CAZAR" sub="Busca por marca, modelo o cualquier término" />}
        {!loading && searched && items.length === 0 && <EmptyState emoji="🔍" title="SIN RESULTADOS" sub="Prueba con otros filtros o un término diferente" />}
        {!loading && items.length > 0 && (
          <>
            <div style={styles.resultsTop}>
              <span style={styles.resultsInfo}><b>{items.length}</b> resultados · &ldquo;{query.toUpperCase()}&rdquo;</span>
              <select style={styles.sortSel} value={sort} onChange={e => setSort(e.target.value)}>
                <option value="price_asc">PRECIO ↑</option>
                <option value="price_desc">PRECIO ↓</option>
                <option value="newest">MÁS RECIENTES</option>
              </select>
            </div>
            <div style={styles.grid}>
              {items.map(item => <Card key={item.id} item={item} onAlert={() => onOpenModal(query)} />)}
            </div>
          </>
        )}
      </div>
    </main>
  )
}

function StatPill({ label, value, color }: { label: string; value: any; color: string }) {
  return (
    <div style={{ background: '#111', border: '1px solid #222', borderRadius: 6, padding: '8px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function Card({ item, onAlert }: { item: PalaItem; onAlert: () => void }) {
  const isChollo = item.price > 0 && item.price < 80
  const condLow = item.condition?.toLowerCase() ?? ''
  const isNuevo = condLow.includes('new') || condLow.includes('nuevo') || condLow.includes('sin abrir')
  const platColor = item.platform === 'wallapop' ? '#13C1AC' : '#09B1BA'

  function formatDate(dateStr: string) {
    if (!dateStr) return null
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return null
    const diffDays = Math.floor((new Date().getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return 'Hoy'
    if (diffDays === 1) return 'Ayer'
    if (diffDays < 7) return `Hace ${diffDays} días`
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const dateLabel = formatDate(item.date)

  return (
    <a href={item.url} target="_blank" rel="noopener" style={styles.card}>
      {isChollo && <div style={styles.badgeChollo}>🔥 CHOLLO</div>}
      {isNuevo && !isChollo && <div style={styles.badgeNuevo}>NUEVO</div>}
      <div style={styles.cardImg}>
        {item.img
          ? <img src={item.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 32 }}>🏓</span>
        }
      </div>
      <div style={styles.cardBody}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: platColor, display: 'inline-block' }} />
          <span style={{ fontSize: 11, color: platColor, fontWeight: 700, letterSpacing: 1 }}>{item.platform?.toUpperCase()}</span>
        </div>
        <div style={styles.cardTitle}>{item.title}</div>
        <div style={styles.cardBottom}>
          <span style={styles.cardPrice}>{item.price}€</span>
          <span style={styles.condChip}>{item.condition}</span>
        </div>
        <div style={styles.cardMeta}>
          {item.city && <span>📍 {item.city}</span>}
          {dateLabel && <span>🕐 {dateLabel}</span>}
        </div>
      </div>
    </a>
  )
}

function Loader() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 80, gap: 16 }}>
      <div style={{ fontSize: 32 }}>⏳</div>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 3, color: '#C8FF00' }}>RASTREANDO CHOLLOS...</div>
    </div>
  )
}

function EmptyState({ emoji, title, sub }: { emoji: string; title: string; sub: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 80, gap: 12 }}>
      <span style={{ fontSize: 48 }}>{emoji}</span>
      <div style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: 28, letterSpacing: 3 }}>{title}</div>
      <div style={{ color: 'rgba(255,255,255,0.4)' }}>{sub}</div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  searchBar: { background: '#0F0F0F', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 },
  searchRow: { display: 'flex', gap: 8, alignItems: 'center' },
  qInput: { flex: 1, background: '#181818', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '12px 16px', fontSize: 15, outline: 'none', fontFamily: 'Barlow, sans-serif' },
  priceInput: { width: 90, background: '#181818', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '12px 16px', fontSize: 15, outline: 'none', fontFamily: 'Barlow, sans-serif' },
  priceSep: { color: 'rgba(255,255,255,0.3)', fontSize: 14, userSelect: 'none' },
  btnSearch: { background: '#C8FF00', color: '#000', border: 'none', padding: '0 28px', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 14, fontWeight: 700, letterSpacing: 2, cursor: 'pointer', height: 46 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chipLabel: { fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: 1, fontFamily: 'Barlow Condensed, sans-serif' },
  chip: { background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.5)', padding: '4px 12px', fontSize: 11, letterSpacing: 1, cursor: 'pointer', fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 600 },
  chipOn: { background: '#C8FF00', borderColor: '#C8FF00', color: '#000' },
  statsRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  resultsArea: { flex: 1, overflow: 'auto', padding: 24 },
  resultsTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  resultsInfo: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 1 },
  sortSel: { background: '#181818', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '6px 12px', fontSize: 12, fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 1, cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 },
  card: { background: '#111', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', textDecoration: 'none', color: '#fff', position: 'relative', transition: 'border-color 0.2s' },
  badgeChollo: { position: 'absolute', top: 10, left: 10, background: '#FF5F1F', color: '#fff', padding: '3px 10px', fontSize: 11, fontWeight: 700, letterSpacing: 1, zIndex: 1, fontFamily: 'Barlow Condensed, sans-serif' },
  badgeNuevo: { position: 'absolute', top: 10, left: 10, background: '#C8FF00', color: '#000', padding: '3px 10px', fontSize: 11, fontWeight: 700, letterSpacing: 1, zIndex: 1, fontFamily: 'Barlow Condensed, sans-serif' },
  cardImg: { height: 160, background: '#181818', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cardBody: { padding: 14, display: 'flex', flexDirection: 'column', gap: 4 },
  cardTitle: { fontSize: 13, lineHeight: 1.4, fontWeight: 500, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  cardBottom: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  cardPrice: { fontSize: 26, fontWeight: 700, color: '#C8FF00', fontFamily: 'Bebas Neue, sans-serif' },
  condChip: { fontSize: 10, padding: '3px 8px', background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5 },
  cardMeta: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, fontSize: 11, color: 'rgba(255,255,255,0.35)' },
}
