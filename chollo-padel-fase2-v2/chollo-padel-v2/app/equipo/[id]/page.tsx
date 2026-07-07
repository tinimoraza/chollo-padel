import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

type Equipo = { id: string; nombre_equipo: string; division: string | null }
type Jugador = { id: string; nombre: string; lado: string | null; talla: string | null; compañero: string | null; activo: boolean }
type Jornada = { id: string; numero: number; fecha: string | null; rival: string; sede: string; partidos_ganados: number; partidos_perdidos: number }
type Partido = { id: string; jornada_id: string; jugador1_id: string | null; jugador2_id: string | null; rival1: string | null; rival2: string | null; resultado: string | null; ganado: boolean | null; orden: number }

function ladoColor(lado: string | null) {
  if (lado === 'DCHA') return { bg: 'rgba(37,99,235,0.12)', color: '#1d4ed8' }
  if (lado === 'REVES') return { bg: 'rgba(100,200,0,0.15)', color: '#3a6b00' }
  return { bg: 'rgba(0,0,0,0.07)', color: '#666' }
}

const SP: React.CSSProperties = { fontFamily: 'Space Grotesk, sans-serif' }

export default async function EquipoPublicoPage({ params }: { params: { id: string } }) {
  const { data: eq } = await supabaseAdmin.from('clubes_equipos').select('id,nombre_equipo,division').eq('id', params.id).single()
  if (!eq) notFound()
  const equipo = eq as Equipo

  const [{ data: jugRaw }, { data: jorRaw }] = await Promise.all([
    supabaseAdmin.from('clubes_jugadores').select('*').eq('equipo_id', params.id).order('nombre'),
    supabaseAdmin.from('equipo_jornadas').select('id,numero,fecha,rival,sede,partidos_ganados,partidos_perdidos').eq('equipo_id', params.id).order('numero', { ascending: false }),
  ])
  const jugadores = (jugRaw || []) as Jugador[]
  const jornadas  = (jorRaw || []) as Jornada[]

  let partidos: Partido[] = []
  if (jornadas.length > 0) {
    const ids = jornadas.map(j => j.id)
    const { data: parRaw } = await supabaseAdmin.from('jornada_partidos').select('*').in('jornada_id', ids).order('orden')
    partidos = (parRaw || []) as Partido[]
  }

  const jPorId = Object.fromEntries(jugadores.map(j => [j.id, j.nombre]))

  // stats
  const statsJug = jugadores.map(j => {
    const pars = partidos.filter(p => p.jugador1_id === j.id || p.jugador2_id === j.id)
    const ganados = pars.filter(p => p.ganado).length
    return { jugador: j, jugados: pars.length, ganados, perdidos: pars.length - ganados }
  }).filter(s => s.jugados > 0).sort((a, b) => b.ganados - a.ganados)

  const victorias  = jornadas.filter(j => j.partidos_ganados > j.partidos_perdidos).length
  const derrotas   = jornadas.filter(j => j.partidos_ganados < j.partidos_perdidos).length
  const empates    = jornadas.filter(j => j.partidos_ganados === j.partidos_perdidos && j.partidos_ganados > 0).length

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', color:'var(--text)' }}>
      <main style={{ maxWidth:860, margin:'0 auto', padding:'40px 24px 80px' }}>

        {/* Cabecera */}
        <div style={{ marginBottom:32 }}>
          <h1 style={{ ...SP, fontWeight:700, fontSize:28, margin:'0 0 4px', color:'var(--text)' }}>
            {equipo.nombre_equipo}
          </h1>
          {equipo.division && (
            <p style={{ ...SP, fontSize:13, color:'var(--muted)', margin:0 }}>{equipo.division}</p>
          )}
        </div>

        {/* Resumen temporada */}
        {jornadas.length > 0 && (
          <div style={{ display:'flex', gap:10, marginBottom:32, flexWrap:'wrap' }}>
            {[
              { v: victorias, l: 'Victorias', c: victorias > derrotas ? '#22c55e' : 'var(--text)' },
              { v: derrotas,  l: 'Derrotas',  c: derrotas > victorias ? '#ef4444' : 'var(--text)' },
              { v: empates,   l: 'Empates',   c: 'var(--text)' },
              { v: partidos.filter(p=>p.ganado).length, l: 'Partidos ganados', c: 'var(--text)' },
            ].map(({ v, l, c }) => (
              <div key={l} style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 20px', minWidth:110 }}>
                <div style={{ ...SP, fontWeight:700, fontSize:26, color: c, lineHeight:1 }}>{v}</div>
                <div style={{ ...SP, fontSize:11, color:'var(--muted)', marginTop:4 }}>{l}</div>
              </div>
            ))}
          </div>
        )}

        {/* Jugadores */}
        <section style={{ marginBottom:40 }}>
          <h2 style={{ ...SP, fontWeight:700, fontSize:18, color:'var(--text)', marginBottom:14 }}>
            Plantilla ({jugadores.filter(j=>j.activo).length})
          </h2>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  {['Jugador','Lado','Talla','Companero'].map(h => (
                    <th key={h} style={{ ...SP, fontSize:11, fontWeight:600, letterSpacing:1, color:'var(--muted)', padding:'8px 12px', textAlign:'left', borderBottom:'1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jugadores.filter(j=>j.activo).map(j => {
                  const lc = ladoColor(j.lado)
                  return (
                    <tr key={j.id}>
                      <td style={{ ...SP, fontSize:13, fontWeight:600, color:'var(--text)', padding:'10px 12px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' }}>{j.nombre}</td>
                      <td style={{ padding:'10px 12px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' }}>
                        {j.lado && (
                          <span style={{ ...SP, display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:700, background: lc.bg, color: lc.color }}>
                            {j.lado}
                          </span>
                        )}
                      </td>
                      <td style={{ ...SP, fontSize:12, color:'var(--muted)', padding:'10px 12px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' }}>{j.talla || '-'}</td>
                      <td style={{ ...SP, fontSize:12, color:'var(--muted)', padding:'10px 12px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' }}>{j.compañero || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Jornadas */}
        {jornadas.length > 0 && (
          <section style={{ marginBottom:40 }}>
            <h2 style={{ ...SP, fontWeight:700, fontSize:18, color:'var(--text)', marginBottom:14 }}>
              Jornadas
            </h2>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {jornadas.map(j => {
                const resultado = j.partidos_ganados > j.partidos_perdidos ? 'victoria'
                  : j.partidos_ganados < j.partidos_perdidos ? 'derrota' : 'empate'
                const pars = partidos.filter(p => p.jornada_id === j.id)
                return (
                  <div key={j.id} style={{
                    background:'var(--card)', border:'1px solid var(--border)', borderRadius:10, padding:'16px 20px',
                    display:'flex', justifyContent:'space-between', alignItems:'center',
                    borderLeft: `3px solid ${resultado==='victoria'?'#22c55e':resultado==='derrota'?'#ef4444':'var(--border)'}`,
                  }}>
                    <div>
                      <p style={{ ...SP, fontWeight:700, fontSize:14, color:'var(--text)', margin:'0 0 2px' }}>
                        J{j.numero} &mdash; {j.rival}
                      </p>
                      <p style={{ ...SP, fontSize:11, color:'var(--muted)', margin:0 }}>
                        {j.sede === 'local' ? 'Local' : 'Visitante'}
                        {j.fecha && ` - ${new Date(j.fecha).toLocaleDateString('es-ES', { day:'numeric', month:'short' })}`}
                        {` - ${pars.length} partidos`}
                      </p>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <span style={{ ...SP, fontWeight:700, fontSize:18, color:'var(--text)' }}>
                        {j.partidos_ganados} &ndash; {j.partidos_perdidos}
                      </span>
                      {(j.partidos_ganados + j.partidos_perdidos) > 0 && (
                        <span style={{
                          ...SP, fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:4,
                          background: resultado==='victoria'?'rgba(34,197,94,0.12)':resultado==='derrota'?'rgba(239,68,68,0.12)':'rgba(0,0,0,0.06)',
                          color: resultado==='victoria'?'#15803d':resultado==='derrota'?'#b91c1c':'var(--muted)',
                        }}>
                          {resultado.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* detalle partidos por jornada */}
            {jornadas.map(j => {
              const pars = partidos.filter(p => p.jornada_id === j.id)
              if (pars.length === 0) return null
              return (
                <details key={j.id} style={{ marginTop:8 }}>
                  <summary style={{ ...SP, fontSize:13, color:'var(--muted)', cursor:'pointer', padding:'6px 0', userSelect:'none' }}>
                    J{j.numero} - Partidos individuales
                  </summary>
                  <div style={{ paddingLeft:12, marginTop:6, display:'flex', flexDirection:'column', gap:6 }}>
                    {pars.map(p => {
                      const j1 = jPorId[p.jugador1_id || ''] || p.jugador1_id || '?'
                      const j2 = jPorId[p.jugador2_id || ''] || p.jugador2_id || '?'
                      return (
                        <div key={p.id} style={{
                          background:'var(--card)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px',
                          display:'flex', justifyContent:'space-between', alignItems:'center',
                          borderLeft: `2px solid ${p.ganado ? '#22c55e' : '#ef4444'}`,
                        }}>
                          <span style={{ ...SP, fontSize:13, color:'var(--text)' }}>
                            {j1} / {j2}
                            <span style={{ color:'var(--muted)', marginLeft:8 }}>vs {p.rival1 || '?'} / {p.rival2 || '?'}</span>
                            {p.resultado && <span style={{ color:'var(--faint)', marginLeft:8 }}>{p.resultado}</span>}
                          </span>
                          <span style={{ ...SP, fontSize:12, fontWeight:700, color: p.ganado ? '#22c55e' : '#ef4444' }}>
                            {p.ganado ? 'GANADO' : 'PERDIDO'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </details>
              )
            })}
          </section>
        )}

        {/* Estadisticas */}
        {statsJug.length > 0 && (
          <section>
            <h2 style={{ ...SP, fontWeight:700, fontSize:18, color:'var(--text)', marginBottom:14 }}>
              Estadisticas
            </h2>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr>
                    {['#','Jugador','Lado','Jugados','Ganados','Perdidos','%'].map(h => (
                      <th key={h} style={{ ...SP, fontSize:11, fontWeight:600, letterSpacing:1, color:'var(--muted)', padding:'8px 12px', textAlign:'left', borderBottom:'1px solid var(--border)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {statsJug.map((st, i) => {
                    const lc = ladoColor(st.jugador.lado)
                    const pct = Math.round(st.ganados / st.jugados * 100)
                    return (
                      <tr key={st.jugador.id}>
                        <td style={{ ...SP, fontSize:12, color:'var(--faint)', padding:'10px 12px', borderBottom:'1px solid var(--border)', width:40 }}>{i+1}</td>
                        <td style={{ ...SP, fontSize:13, fontWeight:600, color:'var(--text)', padding:'10px 12px', borderBottom:'1px solid var(--border)' }}>{st.jugador.nombre}</td>
                        <td style={{ padding:'10px 12px', borderBottom:'1px solid var(--border)' }}>
                          {st.jugador.lado && (
                            <span style={{ ...SP, display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:700, background: lc.bg, color: lc.color }}>
                              {st.jugador.lado}
                            </span>
                          )}
                        </td>
                        <td style={{ ...SP, fontSize:13, color:'var(--text)', padding:'10px 12px', borderBottom:'1px solid var(--border)' }}>{st.jugados}</td>
                        <td style={{ ...SP, fontSize:13, fontWeight:700, color:'#22c55e', padding:'10px 12px', borderBottom:'1px solid var(--border)' }}>{st.ganados}</td>
                        <td style={{ ...SP, fontSize:13, fontWeight:700, color:'#ef4444', padding:'10px 12px', borderBottom:'1px solid var(--border)' }}>{st.perdidos}</td>
                        <td style={{ padding:'10px 12px', borderBottom:'1px solid var(--border)' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            <div style={{ width:50, height:5, background:'var(--border)', borderRadius:3 }}>
                              <div style={{ height:5, borderRadius:3, width:`${pct}%`, background: pct>=50?'#22c55e':'#ef4444' }} />
                            </div>
                            <span style={{ ...SP, fontSize:12, fontWeight:700, color:'var(--text)' }}>{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

      </main>
    </div>
  )
}
