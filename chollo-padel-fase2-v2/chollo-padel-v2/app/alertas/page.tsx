'use client'
import { useState, useEffect } from 'react'
import Header from '@/components/Header'
import BottomNav from '@/components/BottomNav'

const CONDITION_LABEL: Record<string, string> = {
  new:              'Nuevo',
  un_opened:        'Sin abrir',
  as_good_as_new:   'Como nuevo',
  good:             'Buen estado',
  fair:             'Aceptable',
  has_given_it_all: 'Para piezas',
}
const prettyCondition = (c: string) => CONDITION_LABEL[c] ?? c

interface Alerta {
  id: string
  created_at: string
  query: string
  max_price: number | null
  condition: string | null
  platform: string
  email: string
  activa: boolean
  tipo: string
  item_id: string | null
  item_url: string | null
  item_titulo: string | null
  item_img: string | null
  ultima_notificacion: string | null
}

export default function AlertasPage() {
  const [email, setEmail] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Recuperar email guardado
  useEffect(() => {
    const saved = localStorage.getItem('huntpadel_email')
    if (saved) {
      setEmail(saved)
      setEmailInput(saved)
      cargarAlertas(saved)
    }
  }, [])

  async function cargarAlertas(em: string) {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/alerts?email=${encodeURIComponent(em)}`)
      const data = await res.json()
      setAlertas(data.alertas || [])
    } catch {
      setError('Error cargando alertas.')
    } finally {
      setLoading(false)
    }
  }

  function buscar() {
    if (!emailInput.trim()) return
    localStorage.setItem('huntpadel_email', emailInput.trim())
    setEmail(emailInput.trim())
    cargarAlertas(emailInput.trim())
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

  const busquedas = alertas.filter(a => a.tipo === 'busqueda' || !a.tipo)
  const favoritos = alertas.filter(a => a.tipo === 'favorito')

  return (
    <div style={styles.page}>
      <Header />
      <BottomNav />

      <div style={styles.content}>
        <div style={styles.pageTitle}>MIS ALERTAS</div>
        <p style={styles.pageSubtitle}>Introduce tu email para ver y gestionar tus alertas</p>

        {/* Buscador de email */}
        <div style={styles.emailBar}>
          <input
            type="email"
            value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscar()}
            placeholder="tu@email.com"
            style={styles.emailInput}
          />
          <button onClick={buscar} style={styles.btnBuscar}>
            VER MIS ALERTAS →
          </button>
        </div>

        {loading && (
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, marginTop: 32 }}>Cargando...</p>
        )}

        {error && (
          <p style={{ color: '#FF5F1F', fontSize: 13, marginTop: 32 }}>{error}</p>
        )}

        {email && !loading && alertas.length === 0 && (
          <div style={styles.emptyState}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔔</div>
            <div style={styles.emptyTitle}>NO TIENES ALERTAS</div>
            <p style={styles.emptyText}>Crea alertas desde el buscador para recibir notificaciones cuando aparezcan chollos.</p>
            <a href="/" style={styles.btnIrBuscador}>IR AL BUSCADOR →</a>
          </div>
        )}

        {/* Alertas de búsqueda */}
        {busquedas.length > 0 && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>🔔 ALERTAS DE BÚSQUEDA — {busquedas.length}</div>
            <div style={styles.grid}>
              {busquedas.map(alerta => (
                <div key={alerta.id} style={{ ...styles.card, borderColor: alerta.activa ? 'rgba(200,255,0,0.3)' : 'rgba(255,255,255,0.07)' }}>
                  <div style={styles.cardHeader}>
                    <span style={{ ...styles.badge, ...(alerta.activa ? styles.badgeActiva : styles.badgePausa) }}>
                      {alerta.activa ? 'ACTIVA' : 'PAUSADA'}
                    </span>
                    <div style={styles.cardActions}>
                      <button
                        style={styles.iconBtn}
                        onClick={() => toggleAlerta(alerta.id, alerta.activa)}
                        title={alerta.activa ? 'Pausar' : 'Activar'}
                      >
                        {alerta.activa ? '⏸' : '▶'}
                      </button>
                      <button
                        style={{ ...styles.iconBtn, color: '#FF5F1F' }}
                        onClick={() => deleteAlerta(alerta.id)}
                        title="Eliminar"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                  <div style={styles.cardQuery}>{alerta.query.toUpperCase()}</div>
                  <div style={styles.cardMeta}>
                    {alerta.max_price ? `Máx ${alerta.max_price}€` : 'Sin límite de precio'}
                    {alerta.condition ? ` · ${prettyCondition(alerta.condition)}` : ''}
                    {' · '}{alerta.platform}
                  </div>
                  {alerta.ultima_notificacion && (
                    <div style={styles.cardLastNotif}>
                      Último aviso: {new Date(alerta.ultima_notificacion).toLocaleDateString('es-ES')}
                    </div>
                  )}
                  <button style={styles.btnBuscarAhora} onClick={() => window.location.href = `/?q=${encodeURIComponent(alerta.query)}`}>
                    BUSCAR AHORA →
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Favoritos */}
        {favoritos.length > 0 && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>⭐ FAVORITOS CON ALERTA — {favoritos.length}</div>
            <div style={styles.grid}>
              {favoritos.map(alerta => (
                <div key={alerta.id} style={{ ...styles.card, borderColor: alerta.activa ? 'rgba(200,255,0,0.3)' : 'rgba(255,255,255,0.07)' }}>
                  <div style={styles.cardHeader}>
                    <span style={{ ...styles.badge, ...(alerta.activa ? styles.badgeActiva : styles.badgePausa) }}>
                      {alerta.activa ? 'ACTIVA' : 'PAUSADA'}
                    </span>
                    <div style={styles.cardActions}>
                      <button
                        style={styles.iconBtn}
                        onClick={() => toggleAlerta(alerta.id, alerta.activa)}
                        title={alerta.activa ? 'Pausar' : 'Activar'}
                      >
                        {alerta.activa ? '⏸' : '▶'}
                      </button>
                      <button
                        style={{ ...styles.iconBtn, color: '#FF5F1F' }}
                        onClick={() => deleteAlerta(alerta.id)}
                        title="Eliminar"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                    {alerta.item_img && (
                      <img src={alerta.item_img} width={60} height={60} style={{ objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} alt={alerta.item_titulo ?? ''} />
                    )}
                    <div>
                      <div style={styles.cardQuery}>{(alerta.item_titulo ?? alerta.query).toUpperCase()}</div>
                      <div style={styles.cardMeta}>
                        Avisar si baja de <span style={{ color: '#C8FF00', fontWeight: 700 }}>{alerta.max_price}€</span>
                      </div>
                    </div>
                  </div>
                  {alerta.ultima_notificacion && (
                    <div style={styles.cardLastNotif}>
                      Último aviso: {new Date(alerta.ultima_notificacion).toLocaleDateString('es-ES')}
                    </div>
                  )}
                  {alerta.item_url && (
                    <a href={alerta.item_url} target="_blank" rel="noopener noreferrer" style={styles.btnVerItem}>
                      VER EN WALLAPOP →
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#080808', color: '#fff' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 28px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#0A0A0A' },
  logo: { display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: '#fff', fontFamily: 'Bebas Neue, sans-serif', fontSize: 22, letterSpacing: 3 },
  logoMark: { fontSize: 20 },
  nav: { display: 'flex', gap: 24 },
  navLink: { color: 'rgba(255,255,255,0.4)', textDecoration: 'none', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13, letterSpacing: 2, fontWeight: 600 },
  navLinkActive: { color: '#C8FF00' },
  content: { maxWidth: 900, margin: '0 auto', padding: '40px 28px' },
  pageTitle: { fontFamily: 'Bebas Neue, sans-serif', fontSize: 48, letterSpacing: 4, marginBottom: 8 },
  pageSubtitle: { color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 32 },
  emailBar: { display: 'flex', gap: 10, marginBottom: 40 },
  emailInput: { flex: 1, background: '#111', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', padding: '12px 16px', fontSize: 14, outline: 'none', fontFamily: 'Barlow, sans-serif' },
  btnBuscar: { background: '#C8FF00', color: '#000', border: 'none', padding: '12px 28px', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 14, fontWeight: 700, letterSpacing: 2, cursor: 'pointer' },
  emptyState: { textAlign: 'center', padding: '64px 0' },
  emptyTitle: { fontFamily: 'Bebas Neue, sans-serif', fontSize: 28, letterSpacing: 3, marginBottom: 12, color: 'rgba(255,255,255,0.4)' },
  emptyText: { color: 'rgba(255,255,255,0.3)', fontSize: 13, marginBottom: 24 },
  btnIrBuscador: { display: 'inline-block', background: '#C8FF00', color: '#000', padding: '12px 28px', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 14, fontWeight: 700, letterSpacing: 2, textDecoration: 'none' },
  section: { marginBottom: 48 },
  sectionTitle: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13, letterSpacing: 3, color: 'rgba(255,255,255,0.35)', borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: 12, marginBottom: 20 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 },
  card: { background: '#111', border: '1px solid rgba(255,255,255,0.07)', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  badge: { fontSize: 9, fontWeight: 700, letterSpacing: 1.5, padding: '3px 8px', fontFamily: 'Barlow Condensed, sans-serif' },
  badgeActiva: { background: '#C8FF00', color: '#000' },
  badgePausa: { background: '#333', color: 'rgba(255,255,255,0.4)' },
  cardActions: { display: 'flex', gap: 4 },
  iconBtn: { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14, padding: 4, opacity: 0.7, color: '#fff' },
  cardQuery: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 16, fontWeight: 700, letterSpacing: 1, lineHeight: 1.3 },
  cardMeta: { fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'Barlow, sans-serif' },
  cardLastNotif: { fontSize: 10, color: 'rgba(255,255,255,0.25)', fontFamily: 'Barlow, sans-serif' },
  btnBuscarAhora: { marginTop: 8, background: 'transparent', border: '1px solid rgba(200,255,0,0.3)', color: '#C8FF00', padding: '8px', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, cursor: 'pointer', textAlign: 'center' as const },
  btnVerItem: { marginTop: 8, display: 'block', background: 'transparent', border: '1px solid rgba(200,255,0,0.3)', color: '#C8FF00', padding: '8px', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textDecoration: 'none', textAlign: 'center' as const },
}
