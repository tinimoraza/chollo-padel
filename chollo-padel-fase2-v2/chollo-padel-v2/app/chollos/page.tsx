export default function ChollosPage() {
  return (
    <div className="app-shell">
      <header className="header">
        <a className="logo" href="/">
          <img src="/huntpadel-logo.svg" alt="HuntPadel" height={36} />
        </a>
        <nav className="nav">
          <a className="nav-link" href="/">BUSCADOR</a>
          <a className="nav-link" href="/palas">PALAS</a>
          <a className="nav-link" href="/alertas">MIS ALERTAS</a>
          <a className="nav-link active" href="/chollos" style={{ color: '#FF5F1F' }}>🔥 CHOLLOS</a>
        </nav>
        <a href="/alertas" className="btn-alert-top">+ NUEVA ALERTA</a>
      </header>

      <main style={styles.main}>
        <div style={styles.pageHeader}>
          <h1 style={styles.title}>🔥 CHOLLOS</h1>
          <p style={styles.subtitle}>Próximamente · Estamos rediseñando esta sección</p>
        </div>

        <div style={styles.container}>
          <div style={styles.icon}>🏗️</div>
          <p style={styles.heading}>En construcción</p>
          <p style={styles.body}>
            Estamos rehaciendo el sistema de chollos desde cero para que funcione bien de verdad.
            La nueva versión buscará ofertas directamente en tiendas de pádel y calculará
            el precio de referencia en tiempo real.
          </p>
          <p style={styles.eta}>Mientras tanto, usa el buscador principal.</p>
          <a href="/" style={styles.btn}>IR AL BUSCADOR →</a>
        </div>
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    flex: 1,
    padding: '24px 28px',
    overflowY: 'auto',
    background: '#080808',
    display: 'flex',
    flexDirection: 'column',
  },
  pageHeader: {
    marginBottom: 48,
  },
  title: {
    fontFamily: 'Bebas Neue, sans-serif',
    fontSize: 48,
    letterSpacing: 4,
    color: '#FF5F1F',
    margin: 0,
  },
  subtitle: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 13,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 6,
  },
  container: {
    maxWidth: 480,
    margin: '0 auto',
    marginTop: 48,
    textAlign: 'center',
    padding: '48px 32px',
    border: '1px solid rgba(255,95,31,0.15)',
    background: '#111',
  },
  icon: {
    fontSize: 48,
    marginBottom: 24,
  },
  heading: {
    fontFamily: 'Bebas Neue, sans-serif',
    fontSize: 28,
    letterSpacing: 3,
    color: '#fff',
    margin: '0 0 16px',
  },
  body: {
    fontFamily: 'Barlow, sans-serif',
    fontSize: 14,
    lineHeight: 1.7,
    color: 'rgba(255,255,255,0.5)',
    margin: '0 0 24px',
  },
  eta: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 12,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.25)',
    marginBottom: 32,
  },
  btn: {
    display: 'inline-block',
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 2,
    color: '#FF5F1F',
    border: '1px solid #FF5F1F',
    padding: '10px 24px',
    textDecoration: 'none',
  },
}
