'use client'
import { useEffect, useState, FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import Header from '@/components/Header'

/* ── tipos ── */
type Equipo = {
  id: string; nombre_equipo: string; division: string | null; created_at: string
}
type Jugador = {
  id: string; equipo_id: string; nombre: string
  lado: string | null; talla: string | null; entr: boolean; compañero: string | null
  notas: string | null; activo: boolean
}
type Jornada = {
  id: string; equipo_id: string; numero: number; fecha: string | null
  rival: string; sede: string; partidos_ganados: number; partidos_perdidos: number; notas: string | null
}
type Partido = {
  id: string; jornada_id: string
  jugador1_id: string | null; jugador2_id: string | null
  rival1: string | null; rival2: string | null
  resultado: string | null; ganado: boolean | null; orden: number
}

const LADOS = ['DCHA', 'REVES', 'DOS']
const TALLAS = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
type Tab = 'jugadores' | 'jornadas' | 'stats'

const inp: React.CSSProperties = {
  width: '100%', background: 'var(--card)', border: '1px solid var(--border)',
  color: 'var(--text)', padding: '9px 12px', fontSize: 13, outline: 'none',
  fontFamily: 'Space Grotesk, sans-serif', boxSizing: 'border-box', borderRadius: 6,
}
const lbl: React.CSSProperties = {
  fontSize: 11, letterSpacing: 1, color: 'var(--muted)',
  fontFamily: 'Space Grotesk, sans-serif', display: 'block', marginBottom: 5,
}
const btn: React.CSSProperties = {
  background: 'var(--accent)', color: '#000', border: 'none',
  padding: '9px 20px', fontFamily: 'Space Grotesk, sans-serif',
  fontSize: 13, fontWeight: 700, cursor: 'pointer', borderRadius: 6,
}
const btnG: React.CSSProperties = {
  background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)',
  padding: '8px 16px', fontFamily: 'Space Grotesk, sans-serif',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', borderRadius: 6,
}
const card: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '20px 24px', marginBottom: 16,
}
const TH: React.CSSProperties = {
  fontFamily: 'Space Grotesk, sans-serif', fontSize: 11, fontWeight: 600,
  letterSpacing: 1, color: 'var(--muted)', padding: '8px 12px',
  textAlign: 'left', borderBottom: '1px solid var(--border)',
}
const TD: React.CSSProperties = {
  fontFamily: 'Space Grotesk, sans-serif', fontSize: 13, color: 'var(--text)',
  padding: '10px 12px', borderBottom: '1px solid var(--border)',
  verticalAlign: 'middle',
}

export default function ClubesPanelPage() {
  const [cargando, setCargando]   = useState(true)
  const [user, setUser]           = useState<User | null>(null)
  const [equipo, setEquipo]       = useState<Equipo | null>(null)
  const [jugadores, setJugadores] = useState<Jugador[]>([])
  const [jornadas, setJornadas]   = useState<Jornada[]>([])
  const [partidos, setPartidos]   = useState<Partido[]>([])
  const [tab, setTab]             = useState<Tab>('jugadores')
  const [error, setError]         = useState('')

  const [njNombre, setNjNombre] = useState('')
  const [njLado, setNjLado]     = useState('DCHA')
  const [njTalla, setNjTalla]   = useState('M')
  const [njComp, setNjComp]     = useState('')
  const [njNotas, setNjNotas]   = useState('')
  const [addJug, setAddJug]     = useState(false)

  const [njNum, setNjNum]   = useState('')
  const [njFecha, setNjFecha] = useState('')
  const [njRival, setNjRival] = useState('')
  const [njSede, setNjSede]   = useState<'local'|'visitante'>('local')
  const [addJor, setAddJor]   = useState(false)

  const [jornadaAbierta, setJornadaAbierta] = useState<string | null>(null)

  const [npJ1, setNpJ1]   = useState('')
  const [npJ2, setNpJ2]   = useState('')
  const [npR1, setNpR1]   = useState('')
  const [npR2, setNpR2]   = useState('')
  const [npRes, setNpRes] = useState('')
  const [npGan, setNpGan] = useState<'si'|'no'>('si')
  const [addPar, setAddPar] = useState(false)

  const [nuevoEq, setNuevoEq]   = useState('')
  const [nuevaDiv, setNuevaDiv] = useState('3a Liga Matinal Interclubs')

  useEffect(() => { init() }, [])

  async function init() {
    const { data } = await supabase.auth.getSession()
    if (!data.session) { window.location.href = '/clubes/login'; return }
    setUser(data.session.user)
    await cargar(data.session.user.id)
    setCargando(false)
  }

  async function cargar(userId: string) {
    const { data: eq } = await supabase
      .from('clubes_equipos').select('*').eq('capitan_id', userId).limit(1)
    if (!eq || eq.length === 0) { setCargando(false); return }
    setEquipo(eq[0])
    const [{ data: jug }, { data: jor }] = await Promise.all([
      supabase.from('clubes_jugadores').select('*').eq('equipo_id', eq[0].id).order('nombre'),
      supabase.from('equipo_jornadas').select('*').eq('equipo_id', eq[0].id).order('numero'),
    ])
    setJugadores((jug || []) as Jugador[])
    setJornadas((jor || []) as Jornada[])
    if (jor && jor.length > 0) {
      const ids = (jor as Jornada[]).map(j => j.id)
      const { data: par } = await supabase
        .from('jornada_partidos').select('*').in('jornada_id', ids).order('orden')
      setPartidos((par || []) as Partido[])
    }
  }

  async function crearEquipo(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    const { data, error: err } = await supabase.from('clubes_equipos').insert({
      capitan_id: user.id, nombre_equipo: nuevoEq, division: nuevaDiv,
    }).select().single()
    if (err) { setError(err.message); return }
    setEquipo(data as Equipo)
  }

  async function toggleEntr(j: Jugador) {
    await supabase.from('clubes_jugadores').update({ entr: !j.entr }).eq('id', j.id)
    setJugadores(prev => prev.map(p => p.id === j.id ? { ...p, entr: !p.entr } : p))
  }

  async function guardarJugador(e: FormEvent) {
    e.preventDefault()
    if (!equipo) return
    const { data, error: err } = await supabase.from('clubes_jugadores').insert({
      equipo_id: equipo.id, nombre: njNombre, lado: njLado, talla: njTalla,
      compañero: njComp || null, notas: njNotas || null, entr: false, activo: true,
    }).select().single()
    if (err) { setError(err.message); return }
    setJugadores(prev => [...prev, data as Jugador].sort((a, b) => a.nombre.localeCompare(b.nombre)))
    setNjNombre(''); setNjComp(''); setNjNotas(''); setAddJug(false)
  }

  async function guardarJornada(e: FormEvent) {
    e.preventDefault()
    if (!equipo) return
    const { data, error: err } = await supabase.from('equipo_jornadas').insert({
      equipo_id: equipo.id, numero: parseInt(njNum), fecha: njFecha || null,
      rival: njRival, sede: njSede, partidos_ganados: 0, partidos_perdidos: 0,
    }).select().single()
    if (err) { setError(err.message); return }
    setJornadas(prev => [...prev, data as Jornada].sort((a, b) => a.numero - b.numero))
    setNjNum(''); setNjFecha(''); setNjRival(''); setAddJor(false)
  }

  async function actualizarMarcador(jorId: string, gano: boolean) {
    const jor = jornadas.find(j => j.id === jorId)
    if (!jor) return
    const update = gano
      ? { partidos_ganados: jor.partidos_ganados + 1 }
      : { partidos_perdidos: jor.partidos_perdidos + 1 }
    await supabase.from('equipo_jornadas').update(update).eq('id', jorId)
    setJornadas(prev => prev.map(j => j.id === jorId ? { ...j, ...update } : j))
  }

  async function guardarPartido(e: FormEvent) {
    e.preventDefault()
    if (!jornadaAbierta) return
    const ganado = npGan === 'si'
    const orden = partidos.filter(p => p.jornada_id === jornadaAbierta).length + 1
    const { data, error: err } = await supabase.from('jornada_partidos').insert({
      jornada_id: jornadaAbierta,
      jugador1_id: npJ1 || null, jugador2_id: npJ2 || null,
      rival1: npR1 || null, rival2: npR2 || null,
      resultado: npRes || null, ganado, orden,
    }).select().single()
    if (err) { setError(err.message); return }
    setPartidos(prev => [...prev, data as Partido])
    await actualizarMarcador(jornadaAbierta, ganado)
    setNpJ1(''); setNpJ2(''); setNpR1(''); setNpR2(''); setNpRes(''); setAddPar(false)
  }

  async function borrarPartido(p: Partido) {
    await supabase.from('jornada_partidos').delete().eq('id', p.id)
    setPartidos(prev => prev.filter(x => x.id !== p.id))
    if (p.ganado !== null) await actualizarMarcador(p.jornada_id, !p.ganado)
  }

  function calcStats() {
    return jugadores.map(j => {
      const pars = partidos.filter(p => p.jugador1_id === j.id || p.jugador2_id === j.id)
      const ganados = pars.filter(p => p.ganado).length
      return { jugador: j, jugados: pars.length, ganados, perdidos: pars.length - ganados }
    }).sort((a, b) => b.ganados - a.ganados)
  }

  if (cargando) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'var(--bg)', color:'var(--muted)', fontFamily:'Space Grotesk, sans-serif', fontSize:14 }}>
      Cargando panel...
    </div>
  )

  if (!user) return null

  if (!equipo) return (
    <div style={{ maxWidth:500, margin:'80px auto', padding:'0 24px' }}>
      <h1 style={{ fontFamily:'Space Grotesk, sans-serif', fontWeight:700, fontSize:24, color:'var(--text)', marginBottom:24 }}>Crear equipo</h1>
      <form onSubmit={crearEquipo} style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div>
          <label style={lbl}>NOMBRE DEL EQUIPO</label>
          <input style={inp} value={nuevoEq} onChange={e=>setNuevoEq(e.target.value)} placeholder="BTC Ugao Instalaciones" required />
        </div>
        <div>
          <label style={lbl}>DIVISION / LIGA</label>
          <input style={inp} value={nuevaDiv} onChange={e=>setNuevaDiv(e.target.value)} />
        </div>
        <button type="submit" style={btn}>Crear equipo</button>
      </form>
      {error && <p style={{ color:'#f87171', marginTop:12, fontSize:13 }}>{error}</p>}
    </div>
  )

  const jPorId = Object.fromEntries(jugadores.map(j => [j.id, j.nombre]))
  const jorAb  = jornadas.find(j => j.id === jornadaAbierta)
  const pJor   = partidos.filter(p => p.jornada_id === jornadaAbierta)
  const stats  = calcStats()

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
      <Header />
      <main style={{ maxWidth:900, margin:'0 auto', padding:'32px 24px 80px' }}>

        <div style={{ display:'flex', alignItems:'baseline', gap:16, marginBottom:8 }}>
          <h1 style={{ fontFamily:'Space Grotesk, sans-serif', fontWeight:700, fontSize:26, color:'var(--text)', margin:0 }}>
            {equipo.nombre_equipo}
          </h1>
          {equipo.division && (
            <span style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:12, color:'var(--muted)', fontWeight:500 }}>
              {equipo.division}
            </span>
          )}
        </div>

        <div style={{ display:'flex', gap:8, marginBottom:28, alignItems:'center', flexWrap:'wrap' }}>
          <span style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:12, color:'var(--faint)' }}>Vista publica:</span>
          <a href={`/equipo/${equipo.id}`} target="_blank"
            style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:12, color:'var(--blue-fg)', textDecoration:'underline' }}>
            /equipo/{equipo.id.slice(0,8)}...
          </a>
          <button
            onClick={() => navigator.clipboard.writeText(`https://huntpadel.com/equipo/${equipo.id}`)}
            style={{ ...btnG, fontSize:11, padding:'4px 10px' }}>
            Copiar enlace
          </button>
        </div>

        {error && <p style={{ color:'#f87171', fontSize:13, marginBottom:12 }}>{error}</p>}

        <div style={{ display:'flex', gap:4, marginBottom:28, borderBottom:'1px solid var(--border)' }}>
          {(['jugadores','jornadas','stats'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              fontFamily:'Space Grotesk, sans-serif', fontSize:13,
              fontWeight: tab===t ? 700 : 500,
              color: tab===t ? 'var(--blue-fg)' : 'var(--muted)',
              background:'transparent', border:'none',
              borderBottom: tab===t ? '2px solid var(--blue-fg)' : '2px solid transparent',
              padding:'8px 16px', cursor:'pointer',
            }}>
              {t === 'jugadores' ? `Jugadores (${jugadores.length})` : t === 'jornadas' ? `Jornadas (${jornadas.length})` : 'Estadisticas'}
            </button>
          ))}
        </div>

        {/* TAB JUGADORES */}
        {tab === 'jugadores' && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <p style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:12, color:'var(--muted)', margin:0 }}>
                {jugadores.filter(j=>j.entr).length}/{jugadores.length} camisetas entregadas
              </p>
              <button style={btn} onClick={() => setAddJug(!addJug)}>
                {addJug ? 'Cancelar' : '+ Jugador'}
              </button>
            </div>

            {addJug && (
              <div style={{ ...card, marginBottom:20 }}>
                <h3 style={{ fontFamily:'Space Grotesk, sans-serif', fontWeight:700, fontSize:15, color:'var(--text)', margin:'0 0 16px' }}>Nuevo jugador</h3>
                <form onSubmit={guardarJugador}>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:12 }}>
                    <div>
                      <label style={lbl}>NOMBRE *</label>
                      <input style={inp} value={njNombre} onChange={e=>setNjNombre(e.target.value)} required />
                    </div>
                    <div>
                      <label style={lbl}>LADO</label>
                      <select style={inp} value={njLado} onChange={e=>setNjLado(e.target.value)}>
                        {LADOS.map(l=><option key={l}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lbl}>TALLA</label>
                      <select style={inp} value={njTalla} onChange={e=>setNjTalla(e.target.value)}>
                        {TALLAS.map(t=><option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lbl}>COMPANERO HABITUAL</label>
                      <input style={inp} value={njComp} onChange={e=>setNjComp(e.target.value)} />
                    </div>
                    <div style={{ gridColumn:'2/-1' }}>
                      <label style={lbl}>NOTAS</label>
                      <input style={inp} value={njNotas} onChange={e=>setNjNotas(e.target.value)} />
                    </div>
                  </div>
                  <button type="submit" style={btn}>Guardar</button>
                </form>
              </div>
            )}

            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr>
                    {['Jugador','Lado','Talla','Companero','Notas','Camiseta'].map(h=>(
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jugadores.map(j => (
                    <tr key={j.id} style={{ opacity: j.activo ? 1 : 0.45 }}>
                      <td style={{ ...TD, fontWeight:600 }}>{j.nombre}</td>
                      <td style={TD}>
                        <span style={{
                          display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:700,
                          background: j.lado==='DCHA' ? 'rgba(37,99,235,0.12)' : j.lado==='REVES' ? 'rgba(204,255,0,0.15)' : 'rgba(0,0,0,0.08)',
                          color: j.lado==='DCHA' ? 'var(--blue-fg)' : j.lado==='REVES' ? '#3a6b00' : 'var(--muted)',
                        }}>
                          {j.lado || '-'}
                        </span>
                      </td>
                      <td style={{ ...TD, color:'var(--muted)' }}>{j.talla || '-'}</td>
                      <td style={{ ...TD, color:'var(--muted)', fontSize:12 }}>{j.compañero || '-'}</td>
                      <td style={{ ...TD, color:'var(--faint)', fontSize:12 }}>{j.notas || ''}</td>
                      <td style={TD}>
                        <button onClick={() => toggleEntr(j)} style={{
                          background: j.entr ? 'rgba(34,197,94,0.15)' : 'rgba(0,0,0,0.06)',
                          border: j.entr ? '1px solid rgba(34,197,94,0.4)' : '1px solid var(--border)',
                          color: j.entr ? '#15803d' : 'var(--faint)',
                          borderRadius:5, padding:'3px 10px', fontSize:11, fontWeight:700,
                          cursor:'pointer', fontFamily:'Space Grotesk, sans-serif',
                        }}>
                          {j.entr ? 'V Entregada' : 'Pendiente'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB JORNADAS */}
        {tab === 'jornadas' && (
          <div>
            {jornadaAbierta && jorAb ? (
              <div>
                <button style={{ ...btnG, marginBottom:20 }} onClick={() => { setJornadaAbierta(null); setAddPar(false) }}>
                  &larr; Volver a jornadas
                </button>
                <div style={{ ...card, display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div>
                    <h2 style={{ fontFamily:'Space Grotesk, sans-serif', fontWeight:700, fontSize:18, color:'var(--text)', margin:'0 0 4px' }}>
                      J{jorAb.numero} &mdash; {jorAb.rival}
                    </h2>
                    <p style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:12, color:'var(--muted)', margin:0 }}>
                      {jorAb.sede === 'local' ? 'Local' : 'Visitante'}
                      {jorAb.fecha && ` - ${new Date(jorAb.fecha).toLocaleDateString('es-ES', { day:'numeric', month:'long' })}`}
                    </p>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <span style={{ fontFamily:'Space Grotesk, sans-serif', fontWeight:700, fontSize:22, color:'var(--text)' }}>
                      {jorAb.partidos_ganados} &ndash; {jorAb.partidos_perdidos}
                    </span>
                    <p style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:11, color:'var(--muted)', margin:'2px 0 0' }}>partidos</p>
                  </div>
                </div>

                <div style={{ marginBottom:16 }}>
                  {pJor.map(p => {
                    const j1 = jPorId[p.jugador1_id || ''] || p.jugador1_id || '?'
                    const j2 = jPorId[p.jugador2_id || ''] || p.jugador2_id || '?'
                    return (
                      <div key={p.id} style={{
                        ...card, marginBottom:8, display:'flex', justifyContent:'space-between', alignItems:'center',
                        borderLeft: `3px solid ${p.ganado ? '#22c55e' : '#ef4444'}`,
                      }}>
                        <div>
                          <span style={{ fontFamily:'Space Grotesk, sans-serif', fontWeight:600, fontSize:13, color:'var(--text)' }}>
                            {j1} / {j2}
                          </span>
                          <span style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:12, color:'var(--muted)', marginLeft:10 }}>
                            vs {p.rival1 || '?'} / {p.rival2 || '?'}
                          </span>
                          {p.resultado && (
                            <span style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:12, color:'var(--faint)', marginLeft:10 }}>
                              {p.resultado}
                            </span>
                          )}
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <span style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:12, fontWeight:700, color: p.ganado ? '#22c55e' : '#ef4444' }}>
                            {p.ganado ? 'GANADO' : 'PERDIDO'}
                          </span>
                          <button onClick={() => borrarPartido(p)} style={{ ...btnG, fontSize:11, padding:'3px 8px', color:'#ef4444', borderColor:'rgba(239,68,68,0.3)' }}>x</button>
                        </div>
                      </div>
                    )
                  })}
                  {pJor.length === 0 && (
                    <p style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:13, color:'var(--faint)', textAlign:'center', padding:'24px 0' }}>
                      Sin partidos anotados.
                    </p>
                  )}
                </div>

                {addPar ? (
                  <div style={card}>
                    <h3 style={{ fontFamily:'Space Grotesk, sans-serif', fontWeight:700, fontSize:14, color:'var(--text)', margin:'0 0 14px' }}>Anadir partido</h3>
                    <form onSubmit={guardarPartido}>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10, marginBottom:10 }}>
                        <div>
                          <label style={lbl}>NUESTRO J1</label>
                          <select style={inp} value={npJ1} onChange={e=>setNpJ1(e.target.value)}>
                            <option value="">sin asignar</option>
                            {jugadores.map(j=><option key={j.id} value={j.id}>{j.nombre}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={lbl}>NUESTRO J2</label>
                          <select style={inp} value={npJ2} onChange={e=>setNpJ2(e.target.value)}>
                            <option value="">sin asignar</option>
                            {jugadores.map(j=><option key={j.id} value={j.id}>{j.nombre}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={lbl}>RIVAL 1</label>
                          <input style={inp} value={npR1} onChange={e=>setNpR1(e.target.value)} />
                        </div>
                        <div>
                          <label style={lbl}>RIVAL 2</label>
                          <input style={inp} value={npR2} onChange={e=>setNpR2(e.target.value)} />
                        </div>
                        <div>
                          <label style={lbl}>RESULTADO (ej: 6-2 / 4-6 / 10-7)</label>
                          <input style={inp} value={npRes} onChange={e=>setNpRes(e.target.value)} placeholder="6-3 / 6-4" />
                        </div>
                        <div>
                          <label style={lbl}>GANADO?</label>
                          <select style={inp} value={npGan} onChange={e=>setNpGan(e.target.value as 'si'|'no')}>
                            <option value="si">Si, ganamos</option>
                            <option value="no">No, perdimos</option>
                          </select>
                        </div>
                      </div>
                      <div style={{ display:'flex', gap:8 }}>
                        <button type="submit" style={btn}>Guardar partido</button>
                        <button type="button" style={btnG} onClick={()=>setAddPar(false)}>Cancelar</button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <button style={btn} onClick={() => setAddPar(true)}>+ Anadir partido</button>
                )}
              </div>
            ) : (
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                  <p style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:12, color:'var(--muted)', margin:0 }}>
                    {jornadas.filter(j=>j.partidos_ganados > j.partidos_perdidos).length} victorias &middot;{' '}
                    {jornadas.filter(j=>j.partidos_ganados < j.partidos_perdidos).length} derrotas &middot;{' '}
                    {jornadas.filter(j=>j.partidos_ganados === j.partidos_perdidos && j.partidos_ganados > 0).length} empates
                  </p>
                  <button style={btn} onClick={() => setAddJor(!addJor)}>
                    {addJor ? 'Cancelar' : '+ Jornada'}
                  </button>
                </div>

                {addJor && (
                  <div style={{ ...card, marginBottom:20 }}>
                    <h3 style={{ fontFamily:'Space Grotesk, sans-serif', fontWeight:700, fontSize:14, color:'var(--text)', margin:'0 0 14px' }}>Nueva jornada</h3>
                    <form onSubmit={guardarJornada}>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:12 }}>
                        <div>
                          <label style={lbl}>N JORNADA *</label>
                          <input style={inp} type="number" min="1" max="30" value={njNum} onChange={e=>setNjNum(e.target.value)} required />
                        </div>
                        <div>
                          <label style={lbl}>FECHA</label>
                          <input style={inp} type="date" value={njFecha} onChange={e=>setNjFecha(e.target.value)} />
                        </div>
                        <div>
                          <label style={lbl}>RIVAL *</label>
                          <input style={inp} value={njRival} onChange={e=>setNjRival(e.target.value)} required />
                        </div>
                        <div>
                          <label style={lbl}>SEDE</label>
                          <select style={inp} value={njSede} onChange={e=>setNjSede(e.target.value as 'local'|'visitante')}>
                            <option value="local">Local</option>
                            <option value="visitante">Visitante</option>
                          </select>
                        </div>
                      </div>
                      <button type="submit" style={btn}>Guardar jornada</button>
                    </form>
                  </div>
                )}

                <div>
                  {jornadas.map(j => {
                    const resultado = j.partidos_ganados > j.partidos_perdidos ? 'victoria'
                      : j.partidos_ganados < j.partidos_perdidos ? 'derrota' : 'empate'
                    const pars = partidos.filter(p => p.jornada_id === j.id)
                    return (
                      <div key={j.id}
                        style={{
                          ...card, cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center',
                          borderLeft: `3px solid ${resultado==='victoria'?'#22c55e':resultado==='derrota'?'#ef4444':'var(--border)'}`,
                        }}
                        onClick={() => setJornadaAbierta(j.id)}
                      >
                        <div>
                          <p style={{ fontFamily:'Space Grotesk, sans-serif', fontWeight:700, fontSize:14, color:'var(--text)', margin:'0 0 2px' }}>
                            J{j.numero} &mdash; {j.rival}
                          </p>
                          <p style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:11, color:'var(--muted)', margin:0 }}>
                            {j.sede === 'local' ? 'Local' : 'Visitante'}
                            {j.fecha && ` - ${new Date(j.fecha).toLocaleDateString('es-ES', { day:'numeric', month:'short' })}`}
                            {` - ${pars.length} partidos`}
                          </p>
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                          <span style={{ fontFamily:'Space Grotesk, sans-serif', fontWeight:700, fontSize:18, color:'var(--text)' }}>
                            {j.partidos_ganados} &ndash; {j.partidos_perdidos}
                          </span>
                          {(j.partidos_ganados + j.partidos_perdidos) > 0 && (
                            <span style={{
                              fontFamily:'Space Grotesk, sans-serif', fontSize:11, fontWeight:700,
                              padding:'3px 8px', borderRadius:4,
                              background: resultado==='victoria'?'rgba(34,197,94,0.12)':resultado==='derrota'?'rgba(239,68,68,0.12)':'rgba(0,0,0,0.06)',
                              color: resultado==='victoria'?'#15803d':resultado==='derrota'?'#b91c1c':'var(--muted)',
                            }}>
                              {resultado.toUpperCase()}
                            </span>
                          )}
                          <span style={{ color:'var(--faint)', fontSize:16 }}>&rsaquo;</span>
                        </div>
                      </div>
                    )
                  })}
                  {jornadas.length === 0 && (
                    <p style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:13, color:'var(--faint)', textAlign:'center', padding:'40px 0' }}>
                      Sin jornadas. Pulsa &quot;+ Jornada&quot; para empezar.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB ESTADISTICAS */}
        {tab === 'stats' && (
          <div>
            <h2 style={{ fontFamily:'Space Grotesk, sans-serif', fontWeight:700, fontSize:17, color:'var(--text)', marginBottom:16 }}>
              Estadisticas por jugador
            </h2>
            {partidos.length === 0 ? (
              <p style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:13, color:'var(--faint)', textAlign:'center', padding:'40px 0' }}>
                Anota partidos en la pestana Jornadas para ver estadisticas.
              </p>
            ) : (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr>
                      {['#','Jugador','Lado','Jugados','Ganados','Perdidos','% victorias'].map(h=>(
                        <th key={h} style={TH}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.filter(st=>st.jugados>0).map((st, i) => (
                      <tr key={st.jugador.id}>
                        <td style={{ ...TD, color:'var(--faint)', width:40 }}>{i+1}</td>
                        <td style={{ ...TD, fontWeight:600 }}>{st.jugador.nombre}</td>
                        <td style={TD}>
                          <span style={{
                            display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:700,
                            background: st.jugador.lado==='DCHA'?'rgba(37,99,235,0.12)':st.jugador.lado==='REVES'?'rgba(204,255,0,0.15)':'rgba(0,0,0,0.08)',
                            color: st.jugador.lado==='DCHA'?'var(--blue-fg)':st.jugador.lado==='REVES'?'#3a6b00':'var(--muted)',
                          }}>
                            {st.jugador.lado || '-'}
                          </span>
                        </td>
                        <td style={TD}>{st.jugados}</td>
                        <td style={{ ...TD, color:'#22c55e', fontWeight:700 }}>{st.ganados}</td>
                        <td style={{ ...TD, color:'#ef4444', fontWeight:700 }}>{st.perdidos}</td>
                        <td style={TD}>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <div style={{ flex:1, height:6, background:'var(--border)', borderRadius:3, maxWidth:80 }}>
                              <div style={{ height:6, borderRadius:3, width:`${Math.round(st.ganados/st.jugados*100)}%`, background: st.ganados/st.jugados>0.5?'#22c55e':'#ef4444' }} />
                            </div>
                            <span style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:13, fontWeight:700, color:'var(--text)' }}>
                              {Math.round(st.ganados/st.jugados*100)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {jornadas.length > 0 && (
              <div style={{ marginTop:32 }}>
                <h3 style={{ fontFamily:'Space Grotesk, sans-serif', fontWeight:700, fontSize:15, color:'var(--text)', marginBottom:12 }}>
                  Resumen de temporada
                </h3>
                <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                  {[
                    { label:'Jornadas jugadas', value: jornadas.filter(j=>j.partidos_ganados+j.partidos_perdidos>0).length },
                    { label:'Victorias', value: jornadas.filter(j=>j.partidos_ganados>j.partidos_perdidos).length },
                    { label:'Derrotas', value: jornadas.filter(j=>j.partidos_ganados<j.partidos_perdidos).length },
                    { label:'Partidos totales', value: partidos.length },
                    { label:'Partidos ganados', value: partidos.filter(p=>p.ganado).length },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 20px', minWidth:120 }}>
                      <div style={{ fontFamily:'Space Grotesk, sans-serif', fontWeight:700, fontSize:28, color:'var(--text)', lineHeight:1 }}>{value}</div>
                      <div style={{ fontFamily:'Space Grotesk, sans-serif', fontSize:11, color:'var(--muted)', marginTop:4 }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  )
}
