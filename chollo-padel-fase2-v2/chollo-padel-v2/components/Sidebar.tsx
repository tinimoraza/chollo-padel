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
    if (saved) {
      setEmail(saved)
      cargarAlertas(saved)
    }

    fetch('/api/searches')
      .then(r => r.json())
      .then(d => setTopSearches(d || []))
      .catch(() => {})
  }, [])

  async function cargarAlertas(em: string) {
    if (!em) return
    fetch(`/api/alerts?email=${encodeURIComponent(em)}`)
      .then(r => r.json())
      .then(d => setAlertas(d.alertas || []))
      .catch(() => {})
  }

  async function toggleAlerta(id: string, activa: boolean) {
    await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, activa: !activa }),
    })
    setAlertas(prev => prev.map(a => a.id === id ? { ...a, activa: !activa } : a))
  }

  async function deleteAlerta(id: string) {
    await fetch(`/api/alerts?id=${id}`, { method: 'DELETE' })
    setAlertas(prev => prev.filter(a => a.id !== id))
  }

  return (
    <aside style={styles.aside}>
      {/* Alertas activas */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>🔔 MIS ALERTAS</div>

        {!email ? (
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, lineHeight: 1.5 }}>
            <a href="/alertas" style={{ color: '#C8FF00', textDecoration: 'none' }}>Ve a Mis Alertas →</a> para ver y gestionar tus alertas.
          </p>
        ) : alertas.length === 0 ? (
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, lineHeight: 1.5 }}>
            Aún no tienes alertas. Crea una y te avisamos por email cuando aparezcan chollos.
          </p>
        ) : (
          alertas.slice(0, 5).map(alerta => (
            <div key={alerta.id} style={styles.alertCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ ...styles.alertBadge, ...(alerta.activa ? {} : styles.alertBadgePaused) }}>
                    {alerta.activa ? 'ACTIVA' : 'PAUSA'}
                  </span>
                  <div style={styles.alertName}>
                    {alerta.tipo === 'favorito' ? '⭐ ' : ''}{(alerta.item_titulo ?? alerta.query).toUpperCase()}
                  </div>
                  <div style={styles.alertMeta}>
                    {alerta.max_price ? `Máx ${alerta.max_price}€` : 'Sin límite'} · {alerta.platform}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button style={styles.iconBtn} onClick={() => toggleAlerta(alerta.id, alerta.activa)} title={alerta.activa ? 'Pausar' : 'Activar'}>
                    {alerta.activa ? '⏸' : '▶'}
                  </button>
                  <button style={styles.iconBtn} onClick={() => deleteAlerta(alerta.id)} title="Eliminar">🗑</button>
                </div>
              </div>
            </div>
          ))
        )}

        {email && alertas.length > 5 && (
          <a href="/alertas" style={{ color: '#C8FF00', fontSize: 11, fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 1.5, textDecoration: 'none' }}>
            VER TODAS ({alertas.length}) →
          </a>
        )}

        <button style={styles.btnNewAlert} onClick={() => onOpenModal('')}>
          + NUEVA ALERTA
        </button>
      </div>

      {/* Más buscadas */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>🔥 MÁS BUSCADAS</div>
        <div style={styles.popularGrid}>
          {topSearches.length === 0 && (
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
              Aún no hay búsquedas registradas.
            </p>
          )}
          {topSearches.map(s => (
            <div key={s.query} style={styles.popItem} onClick={() => onOpenModal(s.query)}>
              <span>{s.query}</span>
              <span style={{ color: '#C8FF00' }}>→</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

const styles: Record<string, React.CSSProperties> = {
  aside: { background: '#0A0A0A', borderRight: '1px solid rgba(255,255,255,0.07)', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24, overflowY: 'auto' },
  section: { display: 'flex', flexDirection: 'column', gap: 10 },
  sectionTitle: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 11, letterSpacing: 3, color: 'rgba(255,255,255,0.35)', borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: 10, marginBottom: 4 },
  alertCard: { background: '#111', border: '1px solid rgba(255,255,255,0.07)', padding: 12, cursor: 'default' },
  alertBadge: { display: 'inline-block', background: '#C8FF00', color: '#000', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, padding: '2px 7px', marginBottom: 6, fontFamily: 'Barlow Condensed, sans-serif' },
  alertBadgePaused: { background: '#333', color: 'rgba(255,255,255,0.4)' },
  alertName: { fontSize: 13, fontWeight: 600, fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 1 },
  alertMeta: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 },
  iconBtn: { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14, padding: 2, opacity: 0.6, color: '#fff' },
  btnNewAlert: { background: 'transparent', border: '1px solid #C8FF00', color: '#C8FF00', padding: '10px', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13, fontWeight: 700, letterSpacing: 2, cursor: 'pointer', marginTop: 4 },
  popularGrid: { display: 'flex', flexDirection: 'column', gap: 4 },
  popItem: { padding: '8px 10px', background: '#111', fontSize: 12, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 1 },
}
