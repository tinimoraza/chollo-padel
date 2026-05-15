'use client'
import { useState } from 'react'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    if (!password.trim()) return
    setLoading(true)
    setError('')

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (res.ok) {
      window.location.href = '/'
    } else {
      setError('Contraseña incorrecta')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#080808',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ width: '100%', maxWidth: 360, padding: '0 24px' }}>
        <img src="/huntpadel-logo.svg" alt="HuntPadel" height={40} style={{ marginBottom: 48 }} />
        <div style={{ marginBottom: 12 }}>
          <label style={{
            fontSize: 11, letterSpacing: 2, color: 'rgba(255,255,255,0.4)',
            fontFamily: 'Barlow Condensed, sans-serif', display: 'block', marginBottom: 6,
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
              width: '100%', background: '#111', border: '1px solid rgba(255,255,255,0.1)',
              color: '#fff', padding: '12px 16px', fontSize: 14, outline: 'none',
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
            width: '100%', background: '#C8FF00', color: '#000', border: 'none',
            padding: '12px', fontFamily: 'Barlow Condensed, sans-serif',
            fontSize: 14, fontWeight: 700, letterSpacing: 2, cursor: 'pointer',
          }}
        >
          {loading ? 'ENTRANDO...' : 'ENTRAR →'}
        </button>
        <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, marginTop: 32, textAlign: 'center', fontFamily: 'Barlow, sans-serif' }}>
          Beta privada · huntpadel.com
        </p>
      </div>
    </div>
  )
}