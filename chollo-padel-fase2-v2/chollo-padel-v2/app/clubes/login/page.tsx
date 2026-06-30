'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function ClubesLoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [error, setError] = useState('')
  const [yaLogueado, setYaLogueado] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setYaLogueado(true)
    })
  }, [])

  async function handleEnviar() {
    const limpio = email.trim()
    if (!limpio) return
    setLoading(true)
    setError('')

    const { error: err } = await supabase.auth.signInWithOtp({
      email: limpio,
      options: {
        emailRedirectTo: `${window.location.origin}/clubes/panel`,
      },
    })

    setLoading(false)
    if (err) {
      setError('No se ha podido enviar el enlace. Inténtalo de nuevo en unos minutos.')
    } else {
      setEnviado(true)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#080808',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ width: '100%', maxWidth: 380, padding: '0 24px' }}>
        <img src="/huntpadel-logo.svg" alt="HuntPadel" height={36} style={{ marginBottom: 40 }} />

        <p style={{
          fontSize: 11, letterSpacing: 2, color: '#C8FF00',
          fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, marginBottom: 10,
        }}>
          CLUBES
        </p>
        <h1 style={{
          fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700,
          fontSize: 28, color: '#fff', marginBottom: 24,
        }}>
          Accede a tu equipo
        </h1>

        {yaLogueado && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontFamily: 'Barlow, sans-serif', marginBottom: 12 }}>
              Ya tienes una sesión abierta en este navegador.
            </p>
            <a
              href="/clubes/panel"
              style={{
                display: 'inline-block', width: '100%', textAlign: 'center', boxSizing: 'border-box',
                background: '#C8FF00', color: '#000', textDecoration: 'none',
                padding: '12px', fontFamily: 'Barlow Condensed, sans-serif',
                fontSize: 14, fontWeight: 700, letterSpacing: 2,
              }}
            >
              IR A MI PANEL →
            </a>
          </div>
        )}

        {enviado ? (
          <p style={{ color: '#C8FF00', fontSize: 14, fontFamily: 'Barlow, sans-serif', lineHeight: 1.6 }}>
            Te hemos enviado un enlace de acceso a <strong>{email}</strong>. Ábrelo desde
            este mismo dispositivo para entrar a tu panel.
          </p>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={{
                fontSize: 11, letterSpacing: 2, color: 'rgba(255,255,255,0.4)',
                fontFamily: 'Barlow Condensed, sans-serif', display: 'block', marginBottom: 6,
              }}>
                TU EMAIL
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleEnviar()}
                placeholder="capitan@equipo.com"
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
              onClick={handleEnviar}
              disabled={loading}
              style={{
                width: '100%', background: '#C8FF00', color: '#000', border: 'none',
                padding: '12px', fontFamily: 'Barlow Condensed, sans-serif',
                fontSize: 14, fontWeight: 700, letterSpacing: 2, cursor: 'pointer',
              }}
            >
              {loading ? 'ENVIANDO...' : 'ENVIARME EL ENLACE →'}
            </button>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11.5, marginTop: 16, lineHeight: 1.5 }}>
              Sin contraseñas. Te enviamos un enlace de un solo uso a tu email para entrar.
            </p>
          </>
        )}

        <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, marginTop: 32, textAlign: 'center', fontFamily: 'Barlow, sans-serif' }}>
          Beta privada · huntpadel.com
        </p>
      </div>
    </div>
  )
}
