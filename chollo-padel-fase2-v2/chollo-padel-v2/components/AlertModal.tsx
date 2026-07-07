'use client'
import { useState, useEffect } from 'react'

export default function AlertModal({ prefillQuery, onClose }: { prefillQuery: string; onClose: () => void }) {
  const [query, setQuery] = useState(prefillQuery)
  const [maxPrice, setMaxPrice] = useState('')
  const [condition, setCondition] = useState('')
  const [platform, setPlatform] = useState('all')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Prerrellenar email desde localStorage al abrir el modal
  useEffect(() => {
    const savedEmail = localStorage.getItem('huntpadel_email')
    if (savedEmail) setEmail(savedEmail)
  }, [])

  async function saveAlert() {
    if (!query.trim() || !email.trim()) {
      setError('El nombre de búsqueda y el email son obligatorios')
      return
    }
    setSaving(true)
    setError('')

    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          max_price: maxPrice ? parseInt(maxPrice) : null,
          condition: condition || null,
          platform,
          email: email.trim(),
        }),
      })

      if (!res.ok) throw new Error('Error guardando')

      // Guardar email en localStorage para futuras alertas
      localStorage.setItem('huntpadel_email', email.trim())

      setSaved(true)
      setTimeout(onClose, 1800)
    } catch {
      setError('Error al guardar. Inténtalo de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        <div style={styles.title}>NUEVA ALERTA</div>
        <p style={styles.subtitle}>Te avisamos por email cuando aparezcan chollos que encajen</p>

        {saved ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 48 }}>✅</div>
            <div style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: 2, marginTop: 12, color: 'var(--accent-fg)' }}>¡ALERTA GUARDADA!</div>
          </div>
        ) : (
          <>
            <Field label="Qué buscas *">
              <input style={styles.input} value={query} onChange={e => setQuery(e.target.value)} placeholder="Ej: Bullpadel Hack 03" />
            </Field>
            <Field label="Tu email *">
              <input style={styles.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" />
            </Field>
            <Field label="Precio máximo (€)">
              <input style={styles.input} type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="Sin límite" />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Estado">
                <select style={styles.input} value={condition} onChange={e => setCondition(e.target.value)}>
                  <option value="">Cualquiera</option>
                  <option value="nuevo">Nuevo</option>
                  <option value="buen">Buen estado</option>
                  <option value="aceptable">Aceptable</option>
                </select>
              </Field>
              <Field label="Plataforma">
                <select style={styles.input} value={platform} onChange={e => setPlatform(e.target.value)}>
                  <option value="all">Ambas</option>
                  <option value="wallapop">Wallapop</option>
                  <option value="vinted">Vinted</option>
                </select>
              </Field>
            </div>

            {error && <div style={styles.errorMsg}>{error}</div>}

            <div style={styles.actions}>
              <button style={styles.btnCancel} onClick={onClose}>CANCELAR</button>
              <button style={styles.btnSave} onClick={saveAlert} disabled={saving}>
                {saving ? 'GUARDANDO...' : 'GUARDAR →'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, letterSpacing: 1.5, color: 'var(--muted)', fontFamily: 'Space Grotesk, sans-serif', display: 'block', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--card)', border: '1px solid var(--border)', padding: 32, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', borderRadius: 10, boxShadow: 'var(--card-shadow-hover)' },
  title: { fontFamily: 'Bebas Neue, sans-serif', fontSize: 28, letterSpacing: 4, marginBottom: 6, color: 'var(--text)' },
  subtitle: { color: 'var(--muted)', fontSize: 13, marginBottom: 24 },
  input: { width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 14px', fontSize: 14, outline: 'none', fontFamily: 'Barlow, sans-serif', borderRadius: 6, boxSizing: 'border-box' as const },
  actions: { display: 'flex', gap: 12, marginTop: 24 },
  btnCancel: { flex: 1, background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: 12, fontFamily: 'Space Grotesk, sans-serif', fontSize: 13, letterSpacing: 2, cursor: 'pointer', borderRadius: 6 },
  btnSave: { flex: 2, background: 'var(--accent)', color: '#000', border: 'none', padding: 12, fontFamily: 'Space Grotesk, sans-serif', fontSize: 14, fontWeight: 700, letterSpacing: 2, cursor: 'pointer', borderRadius: 6 },
  errorMsg: { background: 'rgba(255,95,31,0.1)', border: '1px solid rgba(255,95,31,0.3)', color: '#DC2626', padding: '10px 14px', fontSize: 12, marginTop: 8, borderRadius: 4 },
}
