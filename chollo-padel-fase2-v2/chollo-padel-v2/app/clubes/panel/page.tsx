'use client'
import { useEffect, useState, FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

type Equipo = {
  id: string
  nombre_equipo: string
  division: string | null
  created_at: string
}

type Jugador = {
  id: string
  equipo_id: string
  nombre: string
  telefono: string | null
  email: string | null
  nivel: string | null
  notas: string | null
  created_at: string
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--card)', border: '1px solid var(--border)',
  color: 'var(--text)', padding: '10px 14px', fontSize: 14, outline: 'none',
  fontFamily: 'Barlow, sans-serif', boxSizing: 'border-box', borderRadius: 6,
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, letterSpacing: 1.5, color: 'var(--muted)',
  fontFamily: 'Barlow Condensed, sans-serif', display: 'block', marginBottom: 6,
}

const btnPrimary: React.CSSProperties = {
  background: 'var(--accent)', color: '#000', border: 'none',
  padding: '11px 22px', fontFamily: 'Barlow Condensed, sans-serif',
  fontSize: 13.5, fontWeight: 700, letterSpacing: 1.5, cursor: 'pointer', borderRadius: 7,
}

const btnGhost: React.CSSProperties = {
  background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)',
  padding: '10px 18px', fontFamily: 'Barlow Condensed, sans-serif',
  fontSize: 12.5, fontWeight: 600, letterSpacing: 1, cursor: 'pointer', borderRadius: 7,
}

export default function ClubesPanelPage() {
  const [cargando, setCargando] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [equipo, setEquipo] = useState<Equipo | null>(null)
  const [jugadores, setJugadores] = useState<Jugador[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function init() {
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      window.location.href = '/clubes/login'
      return
    }
    setUser(data.session.user)
    await cargarEquipo(data.session.user.id)
    setCargando(false)
  }

  async function cargarEquipo(userId: string) {
    const { data: equipos, error: errEquipo } = await supabase
      .from('clubes_equipos')
      .select('id,nombre_equipo,division,created_at')
      .eq('capitan_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)

    if (errEquipo) {
      setError(errEquipo.message)
      return
    }
    const eq = equipos?.[0] ?? null
    setEquipo(eq)

    if (eq) {
      const { data: js, error: errJ } = await supabase
        .from('clubes_jugadores')
        .select('id,equipo_id,nombre,telefono,email,nivel,notas,created_at')
        .eq('equipo_id', eq.id)
        .order('created_at', { ascending: true })
      if (errJ) {
        setError(errJ.message)
      } else {
        setJugadores(js ?? [])
      }
    }
  }

  async function handleCerrarSesion() {
    await supabase.auth.signOut()
    window.location.href = '/clubes/login'
  }

  if (cargando) {
    return (
      <div style={pageWrap}>
        <p style={{ color: 'var(--muted)', fontFamily: 'Barlow, sans-serif' }}>Cargando…</p>
      </div>
    )
  }

  return (
    <div style={pageWrap}>
      <div style={{ width: '100%', maxWidth: 720 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <img src="/huntpadel-logo.svg" alt="HuntPadel" height={32} />
          <button onClick={handleCerrarSesion} style={btnGhost}>CERRAR SESIÓN</button>
        </div>

        {error && (
          <p style={{ color: '#FF5F1F', fontSize: 13, marginBottom: 16, fontFamily: 'Barlow, sans-serif' }}>{error}</p>
        )}

        {!equipo ? (
          <CrearEquipo userId={user!.id} onCreado={() => cargarEquipo(user!.id)} />
        ) : (
          <PanelEquipo
            equipo={equipo}
            jugadores={jugadores}
            onChange={() => cargarEquipo(user!.id)}
          />
        )}
      </div>
    </div>
  )
}

const pageWrap: React.CSSProperties = {
  minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)',
  display: 'flex', justifyContent: 'center', padding: '48px 24px',
}

function CrearEquipo({ userId, onCreado }: { userId: string; onCreado: () => void }) {
  const [nombre, setNombre] = useState('')
  const [division, setDivision] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCrear(e: FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return
    setLoading(true)
    setError('')
    const { error: err } = await supabase.from('clubes_equipos').insert({
      capitan_id: userId,
      nombre_equipo: nombre.trim(),
      division: division.trim() || null,
    })
    setLoading(false)
    if (err) {
      setError(err.message)
    } else {
      onCreado()
    }
  }

  return (
    <form onSubmit={handleCrear} style={{ maxWidth: 420 }}>
      <p style={{
        fontSize: 11, letterSpacing: 2, color: 'var(--accent-fg)',
        fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, marginBottom: 10,
      }}>
        BIENVENIDO
      </p>
      <h1 style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 26, marginBottom: 20 }}>
        Crea tu equipo
      </h1>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>NOMBRE DEL EQUIPO</label>
        <input style={inputStyle} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej. Pádel Indios" />
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>DIVISIÓN / CATEGORÍA</label>
        <input style={inputStyle} value={division} onChange={e => setDivision(e.target.value)} placeholder="Ej. 2ª Autonómica" />
      </div>

      {error && <p style={{ color: '#FF5F1F', fontSize: 12, marginBottom: 12 }}>{error}</p>}

      <button type="submit" disabled={loading} style={btnPrimary}>
        {loading ? 'CREANDO...' : 'CREAR EQUIPO →'}
      </button>
    </form>
  )
}

function PanelEquipo({
  equipo, jugadores, onChange,
}: { equipo: Equipo; jugadores: Jugador[]; onChange: () => void }) {
  const [editandoEquipo, setEditandoEquipo] = useState(false)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  return (
    <div>
      {!editandoEquipo ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 28, marginBottom: 4 }}>
              {equipo.nombre_equipo}
            </h1>
            {equipo.division && (
              <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>{equipo.division}</p>
            )}
          </div>
          <button onClick={() => setEditandoEquipo(true)} style={btnGhost}>EDITAR EQUIPO</button>
        </div>
      ) : (
        <EditarEquipo equipo={equipo} onDone={() => { setEditandoEquipo(false); onChange() }} />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderTop: '1px solid var(--border)', paddingTop: 28 }}>
        <h2 style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 18, letterSpacing: 0.5 }}>
          PLANTILLA ({jugadores.length})
        </h2>
        {!mostrarForm && (
          <button onClick={() => { setEditId(null); setMostrarForm(true) }} style={btnPrimary}>
            + AÑADIR JUGADOR
          </button>
        )}
      </div>

      {mostrarForm && (
        <FormJugador
          equipoId={equipo.id}
          jugador={editId ? jugadores.find(j => j.id === editId) ?? null : null}
          onDone={() => { setMostrarForm(false); setEditId(null); onChange() }}
          onCancel={() => { setMostrarForm(false); setEditId(null) }}
        />
      )}

      {jugadores.length === 0 && !mostrarForm && (
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Todavía no has añadido jugadores.</p>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {jugadores.map(j => (
          <FilaJugador
            key={j.id}
            jugador={j}
            onEditar={() => { setEditId(j.id); setMostrarForm(true) }}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  )
}

function EditarEquipo({ equipo, onDone }: { equipo: Equipo; onDone: () => void }) {
  const [nombre, setNombre] = useState(equipo.nombre_equipo)
  const [division, setDivision] = useState(equipo.division ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleGuardar() {
    if (!nombre.trim()) return
    setLoading(true)
    setError('')
    const { error: err } = await supabase
      .from('clubes_equipos')
      .update({ nombre_equipo: nombre.trim(), division: division.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', equipo.id)
    setLoading(false)
    if (err) setError(err.message)
    else onDone()
  }

  return (
    <div style={{ marginBottom: 32, maxWidth: 420 }}>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>NOMBRE DEL EQUIPO</label>
        <input style={inputStyle} value={nombre} onChange={e => setNombre(e.target.value)} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>DIVISIÓN / CATEGORÍA</label>
        <input style={inputStyle} value={division} onChange={e => setDivision(e.target.value)} />
      </div>
      {error && <p style={{ color: '#FF5F1F', fontSize: 12, marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={handleGuardar} disabled={loading} style={btnPrimary}>
          {loading ? 'GUARDANDO...' : 'GUARDAR →'}
        </button>
        <button onClick={onDone} style={btnGhost}>CANCELAR</button>
      </div>
    </div>
  )
}

function FormJugador({
  equipoId, jugador, onDone, onCancel,
}: { equipoId: string; jugador: Jugador | null; onDone: () => void; onCancel: () => void }) {
  const [nombre, setNombre] = useState(jugador?.nombre ?? '')
  const [telefono, setTelefono] = useState(jugador?.telefono ?? '')
  const [email, setEmail] = useState(jugador?.email ?? '')
  const [nivel, setNivel] = useState(jugador?.nivel ?? '')
  const [notas, setNotas] = useState(jugador?.notas ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleGuardar(e: FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return
    setLoading(true)
    setError('')

    const payload = {
      nombre: nombre.trim(),
      telefono: telefono.trim() || null,
      email: email.trim() || null,
      nivel: nivel.trim() || null,
      notas: notas.trim() || null,
    }

    const { error: err } = jugador
      ? await supabase.from('clubes_jugadores').update(payload).eq('id', jugador.id)
      : await supabase.from('clubes_jugadores').insert({ ...payload, equipo_id: equipoId })

    setLoading(false)
    if (err) setError(err.message)
    else onDone()
  }

  return (
    <form onSubmit={handleGuardar} style={{
      background: 'var(--card)', border: '1px solid var(--border)', padding: 20, marginBottom: 16,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>NOMBRE *</label>
          <input style={inputStyle} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre y apellidos" />
        </div>
        <div>
          <label style={labelStyle}>NIVEL / CATEGORÍA</label>
          <input style={inputStyle} value={nivel} onChange={e => setNivel(e.target.value)} placeholder="Ej. 3ª categoría" />
        </div>
        <div>
          <label style={labelStyle}>TELÉFONO</label>
          <input style={inputStyle} value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="600 000 000" />
        </div>
        <div>
          <label style={labelStyle}>EMAIL</label>
          <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jugador@email.com" />
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>NOTAS</label>
        <input style={inputStyle} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Posición, disponibilidad..." />
      </div>
      {error && <p style={{ color: '#FF5F1F', fontSize: 12, marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="submit" disabled={loading} style={btnPrimary}>
          {loading ? 'GUARDANDO...' : jugador ? 'GUARDAR CAMBIOS →' : 'AÑADIR JUGADOR →'}
        </button>
        <button type="button" onClick={onCancel} style={btnGhost}>CANCELAR</button>
      </div>
    </form>
  )
}

function FilaJugador({
  jugador, onEditar, onChange,
}: { jugador: Jugador; onEditar: () => void; onChange: () => void }) {
  const [borrando, setBorrando] = useState(false)

  async function handleBorrar() {
    if (!window.confirm(`¿Eliminar a ${jugador.nombre} del equipo?`)) return
    setBorrando(true)
    await supabase.from('clubes_jugadores').delete().eq('id', jugador.id)
    onChange()
  }

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      background: 'var(--card)', border: '1px solid var(--border)', padding: '14px 18px',
    }}>
      <div>
        <p style={{ fontSize: 15, fontWeight: 600 }}>{jugador.nombre}</p>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>
          {[jugador.nivel, jugador.telefono, jugador.email].filter(Boolean).join(' · ') || '—'}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onEditar} style={{ ...btnGhost, padding: '7px 14px', fontSize: 11.5 }}>EDITAR</button>
        <button onClick={handleBorrar} disabled={borrando} style={{ ...btnGhost, padding: '7px 14px', fontSize: 11.5, color: '#FF5F1F', borderColor: 'rgba(220,38,38,0.3)' }}>
          {borrando ? '...' : 'BORRAR'}
        </bu