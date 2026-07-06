'use client'
import { useEffect, useState } from 'react'

interface Alerta {
  id: string
  query: string
  max_price: number | null
  platform: string
  activa: boolean
  email: string
  tipo: string
  item_titulo: string | null
}

interface SearchEntry {
  query: string
  count: number
}

export default function Sidebar({ onOpenModal }: { onOpenModal: (q: string) => void }) {
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [topSearches, setTopSearches] = useState<SearchEntry[]>([])
  const [email, setEmail] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('huntpadel_email')
    if (saved) { setEmail(saved); cargarAlertas(saved) }
    fetch('/api/searches').then(r => r.json()).then(d => setTopSearches(d || [])).catch(() => {})
  }, [])

  async function cargarAlertas(em: string) {
    if (!em) return
    fetch(`/api/alerts?email=${encodeURIComponent(em)}`)
      .then(r => r.json()).then(d => setAlertas(d.alertas || [])).catch(() => {})
  }

  async function toggleAlerta(id: string, activa: boolean) {
    await fetch('/api/alerts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, activa: !activa }) })
    setAlertas(prev => prev.map(a => a.id === id ? { ...a, activa: !activa } : a))
  }

  async function deleteAlerta(id: string) {
    await fetch(`/api/alerts?id=${id}`, { method: 'DELETE' })
    setAlertas(prev => prev.filter(a => a.id !== id))
  }

  return (
    <aside className="hp-sidebar">
      {/* Alertas */}
      <div className="sidebar-section">
        <div className="sidebar-title">🔔 Mis alertas</div>

        {!email ? (
          <p style={{ color: 'var(--faint)', fontSize: 12, lineHeight: 1.6 }}>
            <a href="/alertas" style={{ color: 'var(--accent-fg)', textDecoration: 'none' }}>Ve a Alertas →</a>{' '}
            para ver y gestionar tus alertas.
          </p>
        ) : alertas.length === 0 ? (
          <p style={{ color: 'var(--faint)', fontSize: 12, lineHeight: 1.6 }}>
            Crea una alerta y te avisamos por email cuando aparezcan chollos.
          </p>
        ) : (
          alertas.slice(0, 5).map(alerta => (
            <div key={alerta.id} style={{
              background: 'var(--bg3)', border: '0.5px solid var(--border)',
              borderRadius: 8, padding: '10px 12px', marginBottom: 4,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'inline-block',
                    background: alerta.activa ? 'var(--accent-dim)' : 'var(--bg3)',
                    color: alerta.activa ? 'var(--accent-fg)' : 'var(--faint)',
                    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, marginBottom: 5,
                  }}>
                    {alerta.activa ? 'ACTIVA' : 'PAUSA'}
                  </span>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {alerta.tipo === 'favorito' ? '⭐ ' : ''}{alerta.item_titulo ?? alerta.query}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>
                    {alerta.max_price ? `Máx ${alerta.max_price}€` : 'Sin límite'} · {alerta.platform}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: 0.5, color: 'var(--text)', padding: 2 }}
                    onClick={() => toggleAlerta(alerta.id, alerta.activa)}>{alerta.activa ? '⏸' : '▶'}</button>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: 0.5, color: 'var(--text)', padding: 2 }}
                    onClick={() => deleteAlerta(alerta.id)}>🗑</button>
                </div>
              </div>
            </div>
          ))
        )}

        {email && alertas.length > 5 && (
          <a href="/alertas" style={{ color: 'var(--accent-fg)', fontSize: 11, textDecoration: 'none' }}>
            Ver todas ({alertas.length}) →
          </a>
        )}

        <button style={{
          background: 'transparent', border: '0.5px solid rgba(61,102,0,0.3)',
          color: 'var(--accent-fg)', padding: '9px 14px', borderRadius: 7,
          fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 6, width: '100%',
          letterSpacing: '0.03em',
        }} onClick={() => onOpenModal('')}>
          + Nueva alerta
        </button>
      </div>

      {/* Más buscadas */}
      <div className="sidebar-section">
        <div className="sidebar-title">🔥 Más buscadas</div>
        {topSearches.length === 0 && (
          <p style={{ color: 'var(--faint)', fontSize: 12 }}>Sin búsquedas registradas aún.</p>
        )}
        {topSearches.map(s => (
          <div key={s.query} className="sidebar-item" onClick={() => onOpenModal(s.query)}>
            <span className="sidebar-item-label">{s.query}</span>
            <span style={{ color: 'var(--accent-fg)', fontSize: 12 }}>→</span>
          </div>
        ))}
      </div>
    </aside>
  )
}
