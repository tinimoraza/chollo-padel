import Link from 'next/link'

export const metadata = {
  title: 'Clubes — gestiona tu equipo de liga',
  description: 'Crea tu equipo, añade jugadores, organiza el calendario y registra resultados. Gratis para capitanes de equipo.',
}

export default function ClubesLandingPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#080808', color: '#fff', fontFamily: 'Barlow, sans-serif' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '80px 24px 64px' }}>
        <img src="/huntpadel-logo.svg" alt="HuntPadel" height={36} style={{ marginBottom: 40 }} />

        <p style={{
          fontSize: 12, letterSpacing: 2, color: '#C8FF00',
          fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, marginBottom: 12,
        }}>
          NUEVO · PARA CAPITANES DE EQUIPO
        </p>

        <h1 style={{
          fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700,
          fontSize: 'clamp(32px, 6vw, 56px)', lineHeight: 1.05, marginBottom: 20,
        }}>
          Gestiona tu equipo de liga de pádel
        </h1>

        <p style={{ fontSize: 17, lineHeight: 1.6, color: 'rgba(255,255,255,0.65)', marginBottom: 36, maxWidth: 560 }}>
          Da de alta tu equipo, añade a tus jugadores con sus datos y lleva el control de la
          plantilla desde un apartado privado. Solo tú, como capitán, tienes acceso.
        </p>

        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 40px', display: 'grid', gap: 12 }}>
          {[
            'Nombre del equipo y división de liga',
            'Plantilla de jugadores con sus datos de contacto',
            'Acceso privado solo para el capitán, sin contraseñas que recordar',
          ].map(item => (
            <li key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14.5, color: 'rgba(255,255,255,0.8)' }}>
              <span style={{ color: '#C8FF00', fontWeight: 700 }}>→</span>
              {item}
            </li>
          ))}
        </ul>

        <Link
          href="/clubes/login"
          style={{
            display: 'inline-block', background: '#C8FF00', color: '#000', textDecoration: 'none',
            padding: '14px 28px', fontFamily: 'Barlow Condensed, sans-serif',
            fontSize: 15, fontWeight: 700, letterSpacing: 1.5,
          }}
        >
          ENTRAR O CREAR MI EQUIPO →
        </Link>

        <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, marginTop: 40 }}>
          Beta privada · huntpadel.com/clubes
        </p>
      </div>
    </div>
  )
}
