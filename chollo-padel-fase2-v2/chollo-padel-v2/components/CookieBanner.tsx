'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('hp_cookies_ok')) setVisible(true)
  }, [])

  if (!visible) return null

  const accept = () => {
    localStorage.setItem('hp_cookies_ok', '1')
    setVisible(false)
  }

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
      background: 'var(--card)', borderTop: '1px solid var(--border)',
      padding: '14px 24px', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      boxShadow: '0 -4px 20px rgba(0,0,0,0.15)',
    }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', fontFamily: "'Barlow', sans-serif", maxWidth: 680 }}>
        Usamos cookies técnicas para el inicio de sesión y estadísticas anónimas sin cookies (Vercel Analytics).
        Sin publicidad ni rastreo.{' '}
        <Link href="/legal" style={{ color: 'var(--accent-fg)', textDecoration: 'none' }}>Más info</Link>
      </p>
      <button
        onClick={accept}
        style={{
          background: 'var(--accent-fg)', color: '#fff', border: 'none',
          borderRadius: 6, padding: '8px 20px', fontSize: 13, fontWeight: 700,
          cursor: 'pointer', fontFamily: "'Space Grotesk', sans-serif", whiteSpace: 'nowrap',
        }}
      >
        Entendido
      </button>
    </div>
  )
}
