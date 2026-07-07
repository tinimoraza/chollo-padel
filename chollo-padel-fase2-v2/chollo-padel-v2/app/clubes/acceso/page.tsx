'use client'
import { useState } from 'react'

export default function ClubesAccesoPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    if (!password.trim()) return
    setLoading(true)
    setError('')

    const res = await fetch('/api/clubes-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (res.ok) {
      window.location.href = '/clubes'
    } else {
      setError('Contraseña incorrecta')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ width: '100%', maxWidth: 360, padding: '0 24px' }}>
        <img src="/huntpadel-logo.svg" alt="HuntPadel" height={40} style={{ marginBottom: 48 }} />
        <p style={{
          fontSize: 12, letterSpacing: 2, color: 'var(--accent-fg)',
          fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, marginBottom: 24,
        }}>
          CLUBES · ACCESO PRIVADO
        </p>
        <div style={{ marginBottom: 12 }}>
          <label style={{
            fontSize: 11, letterSpacing: 2, color: 'var(--muted)',
            fontFamily: 'Space Grotesk, sans-serif', display: 'block', marginBottom: 6,
          }}>
            CONTRASEÑA DE ACCESO
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="••••••••"
            style={{
              width: '100%', background: 'var(--card)', border: '1px solid var(--border)',
              color: 'var(--text)', padding: '12px 16px', fontSize: 14, outline: 'none',
              fontFamily: 'Barlow, sans-serif', boxSizing: 'border-box',
            }}
          />
        </div>
        {error && (
          <p style={{ color: '#FF5F1F', fontSize: 12, marginBottom: 12, fontFamily: 'Barlow, sans-serif' }}>
            {error}
          </p>
        )}
        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            width: '100%', background: 'var(--accent)', color: '#fff', border: 'none',
            padding: '12px', fontFamily: 'Space Grotesk, sans-serif',
            fontSize: 14, fontWeight: 700, letterSpacing: 2, cursor: 'pointer',
          }}
        >
          {loading ? 'ENTRANDO...' : 'ENTRAR →'}
        </button>
        <p style={{ color: 'var(--faint)', fontSize: 11, marginTop: 32, textAlign: 'center', fontFamily: 'Barlow, sans-serif' }}>
          Beta privada · huntpadel.com/clubes
        </p>
      </div>
    </div>
  )
}
