import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Aviso legal, privacidad y cookies | HuntPadel',
  description: 'Información legal, política de privacidad y política de cookies de HuntPadel.',
  robots: { index: false, follow: false },
}

const S = {
  page:    { minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Barlow', sans-serif" } as React.CSSProperties,
  inner:   { maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' } as React.CSSProperties,
  back:    { fontSize: 13, color: 'var(--muted)', textDecoration: 'none', display: 'inline-block', marginBottom: 32 } as React.CSSProperties,
  h1:      { fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, letterSpacing: 2, marginBottom: 8, color: 'var(--text)' } as React.CSSProperties,
  updated: { fontSize: 12, color: 'var(--faint)', marginBottom: 48 } as React.CSSProperties,
  h2:      { fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, color: 'var(--accent-fg)', margin: '40px 0 12px' },
  p:       { fontSize: 14, lineHeight: 1.8, color: 'var(--muted)', marginBottom: 12 } as React.CSSProperties,
  ul:      { fontSize: 14, lineHeight: 1.8, color: 'var(--muted)', paddingLeft: 20, marginBottom: 12 } as React.CSSProperties,
  divider: { border: 'none', borderTop: '1px solid var(--border)', margin: '48px 0' } as React.CSSProperties,
}

export default function LegalPage() {
  return (
    <div style={S.page}>
      <div style={S.inner}>
        <Link href="/" style={S.back}>← Volver al inicio</Link>

        <h1 style={S.h1}>Aviso legal, privacidad y cookies</h1>
        <p style={S.updated}>Última actualización: julio 2025</p>

        {/* ── AVISO LEGAL ── */}
        <h2 style={S.h2}>1. Aviso legal e identificación del titular</h2>
        <p style={S.p}>
          En cumplimiento de la Ley 34/2002, de 11 de julio, de Servicios de la Sociedad de la Información y del Comercio Electrónico (LSSI-CE),
          se facilitan los siguientes datos de identificación del titular del sitio web <strong>huntpadel.com</strong>:
        </p>
        <ul style={S.ul}>
          <li><strong>Titular:</strong> Patricia Alonso Fernández</li>
          <li><strong>Correo electrónico de contacto:</strong> hola@huntpadel.com</li>
          <li><strong>Actividad:</strong> Comparador de precios de palas de pádel</li>
        </ul>
        <p style={S.p}>
          HuntPadel es un comparador de precios. No vendemos productos directamente. Los enlaces a tiendas son de terceros con los que podemos mantener acuerdos de afiliación,
          lo que significa que podemos recibir una comisión si realizas una compra a través de ellos, sin coste adicional para ti.
        </p>

        <h2 style={S.h2}>2. Condiciones de uso</h2>
        <p style={S.p}>
          El acceso y uso de este sitio web implica la aceptación de las presentes condiciones. HuntPadel se reserva el derecho de modificar los contenidos
          del sitio sin previo aviso. Los precios mostrados son orientativos y pueden no estar actualizados en tiempo real; recomendamos verificar el precio
          final en la tienda correspondiente antes de cualquier compra.
        </p>
        <p style={S.p}>
          Los datos de precios se obtienen mediante sistemas automatizados de consulta pública. HuntPadel no garantiza la exactitud, completitud
          ni disponibilidad de dichos datos.
        </p>

        <hr style={S.divider} />

        {/* ── PRIVACIDAD ── */}
        <h2 style={S.h2}>3. Política de privacidad</h2>
        <p style={S.p}>
          En cumplimiento del Reglamento (UE) 2016/679 (RGPD) y la Ley Orgánica 3/2018 (LOPDGDD), te informamos de cómo tratamos los datos personales.
        </p>

        <h2 style={{ ...S.h2, fontSize: 13, marginTop: 24 }}>¿Qué datos recogemos?</h2>
        <ul style={S.ul}>
          <li><strong>Dirección de email</strong> — únicamente si te suscribes a alertas de precio o accedes a la zona de Clubes.</li>
          <li><strong>Datos de uso anónimos</strong> — estadísticas de navegación a través de Vercel Analytics (sin cookies, sin identificadores personales).</li>
        </ul>

        <h2 style={{ ...S.h2, fontSize: 13, marginTop: 24 }}>¿Con qué finalidad?</h2>
        <ul style={S.ul}>
          <li>Envío de alertas de precio solicitadas por el usuario.</li>
          <li>Gestión del servicio de Clubes (si aplica).</li>
          <li>Mejora del servicio mediante estadísticas anónimas.</li>
        </ul>

        <h2 style={{ ...S.h2, fontSize: 13, marginTop: 24 }}>¿Cuánto tiempo los conservamos?</h2>
        <p style={S.p}>
          Los emails se conservan mientras el usuario mantenga activa su suscripción o cuenta. Puedes solicitar la eliminación en cualquier momento escribiendo a hola@huntpadel.com.
        </p>

        <h2 style={{ ...S.h2, fontSize: 13, marginTop: 24 }}>Tus derechos</h2>
        <p style={S.p}>
          Tienes derecho de acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad. Puedes ejercerlos escribiendo a hola@huntpadel.com.
          Si consideras que tus derechos no han sido atendidos, puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).
        </p>

        <hr style={S.divider} />

        {/* ── COOKIES ── */}
        <h2 style={S.h2}>4. Política de cookies</h2>
        <p style={S.p}>
          Una cookie es un pequeño fichero de texto que un sitio web almacena en tu navegador.
        </p>

        <h2 style={{ ...S.h2, fontSize: 13, marginTop: 24 }}>Cookies que utilizamos</h2>
        <ul style={S.ul}>
          <li>
            <strong>Cookies técnicas (necesarias):</strong> utilizadas para mantener tu sesión si accedes a la zona de Clubes.
            Son estrictamente necesarias para el funcionamiento del servicio y no requieren consentimiento.
          </li>
          <li>
            <strong>Cookies de análisis:</strong> usamos <strong>Vercel Analytics</strong>, que opera sin cookies ni identificadores personales.
            Recoge datos agregados y anónimos (páginas visitadas, país de origen) de forma compatible con el RGPD sin necesitar consentimiento explícito.
          </li>
        </ul>
        <p style={S.p}>
          No utilizamos cookies de publicidad, seguimiento de terceros ni redes sociales.
        </p>

        <h2 style={{ ...S.h2, fontSize: 13, marginTop: 24 }}>Cómo desactivar las cookies</h2>
        <p style={S.p}>
          Puedes configurar tu navegador para bloquear o eliminar cookies. Ten en cuenta que algunas funciones del sitio podrían dejar de funcionar correctamente.
          Instrucciones para los principales navegadores: {' '}
          <a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-fg)' }}>Chrome</a>,{' '}
          <a href="https://support.mozilla.org/es/kb/Borrar%20cookies" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-fg)' }}>Firefox</a>,{' '}
          <a href="https://support.apple.com/es-es/guide/safari/sfri11471/mac" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-fg)' }}>Safari</a>.
        </p>

        <hr style={S.divider} />

        <p style={{ ...S.p, color: 'var(--faint)', fontSize: 12 }}>
          Para cualquier consulta legal: hola@huntpadel.com
        </p>
      </div>
    </div>
  )
}
