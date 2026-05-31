import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'HuntPadel — Encuentra tu pala al mejor precio'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#090909',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: '-apple-system, Arial, sans-serif',
          position: 'relative',
        }}
      >
        {/* Fondo sutil */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at center, rgba(232,255,74,0.06) 0%, transparent 70%)',
          display: 'flex',
        }} />

        {/* Logo badge */}
        <div style={{
          width: 72, height: 72,
          background: '#E8FF4A',
          borderRadius: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 36,
          fontWeight: 800,
          color: '#000',
          marginBottom: 28,
        }}>
          H
        </div>

        {/* Nombre */}
        <div style={{
          fontSize: 64,
          fontWeight: 700,
          color: '#fff',
          letterSpacing: '-2px',
          marginBottom: 16,
          display: 'flex',
        }}>
          Hunt<span style={{ color: '#E8FF4A' }}>Padel</span>
        </div>

        {/* Tagline */}
        <div style={{
          fontSize: 26,
          color: 'rgba(255,255,255,0.5)',
          letterSpacing: '-0.5px',
          marginBottom: 48,
          display: 'flex',
        }}>
          Un chollo de pádel no espera.
        </div>

        {/* Pills */}
        <div style={{ display: 'flex', gap: 12 }}>
          {['Wallapop', 'Vinted', '+18.000 anuncios', '29 marcas'].map(label => (
            <div key={label} style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              padding: '10px 20px',
              fontSize: 18,
              color: 'rgba(255,255,255,0.6)',
              display: 'flex',
            }}>
              {label}
            </div>
          ))}
        </div>

        {/* URL */}
        <div style={{
          position: 'absolute',
          bottom: 32,
          fontSize: 18,
          color: 'rgba(255,255,255,0.25)',
          display: 'flex',
        }}>
          huntpadel.com
        </div>
      </div>
    ),
    { ...size }
  )
}
