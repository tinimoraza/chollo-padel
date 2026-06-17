/**
 * scripts/fix-falsos-positivos.js
 * =============================================================================
 * Herramienta visual para revisar y corregir los falsos positivos detectados
 * por detectar-falsos-positivos.ts (hermana de fix-duplicados.js, mismo patrón:
 * servidor Node sin dependencias raras + web local).
 *
 * A diferencia del script de detección (que solo informa por consola), esta
 * herramienta permite ACTUAR sobre cada hallazgo desde el navegador:
 *   - Borrar el alias (y su price_snapshot asociado) si la tienda no debería
 *     haber matcheado con ninguna pala del catálogo.
 *   - Repuntar el alias a la pala correcta (buscador en vivo sobre `palas`).
 *   - Ignorar (es ruido del propio heurístico, no se toca nada).
 *
 * Reglas de detección — ver detectar-falsos-positivos.ts para el detalle de
 * cada caso real que motivó cada una (Adidas 3.0/3.3, Nox AT10 Lite, etc.).
 *
 * Uso:
 *   node scripts/fix-falsos-positivos.js   (puerto 4547)
 * =============================================================================
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') })
const http = require('http')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
)

const PORT = 4547

// ─── Detección (misma lógica que detectar-falsos-positivos.ts) ───────────────

const MARCAS = [
  'Adidas', 'Bullpadel', 'Siux', 'Nox', 'Drop Shot', 'StarVie', 'Head',
  'Dunlop', 'Vibor-A', 'Enebe', 'Wilson', 'Babolat', 'Royal Padel', 'Varlion',
  'Black Crown', 'Oxdog', 'Kombat', 'Softee', 'Joma', 'Akkeron', 'Kuikma',
  'Puma', 'Lok', 'Tecnifibre', 'Alkemia', 'Vairo', 'Harlem', 'Legend',
  'J-Hayber', 'Prince', 'Mystica', 'Slazenger', 'Asics', 'K-Swiss', 'Munich',
]

function marcaRegex(marca) {
  switch (marca) {
    case 'Vibor-A':     return /vibor.?a/i
    case 'Drop Shot':   return /drop.?shot/i
    case 'Black Crown': return /black.?crown/i
    case 'StarVie':     return /star.?vie/i
    case 'Royal Padel': return /royal.?padel/i
    case 'J-Hayber':    return /j.?hayber/i
    case 'K-Swiss':     return /k.?swiss/i
    default:            return new RegExp(`\\b${marca}\\b`, 'i')
  }
}

function normalizar(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function tieneLite(s) { return /\blite\b/i.test(normalizar(s)) }
function kClass(s) { const m = s.match(/\b(\d{1,2}k)\b/i); return m ? m[1].toLowerCase() : null }
function añoMencionado(s) { const m = s.match(/\b(20[1-3]\d)\b/); return m ? parseInt(m[1]) : null }

async function cargarAliases() {
  const PAGE = 1000
  let todos = [], from = 0
  while (true) {
    const { data, error } = await supabase
      .from('producto_aliases')
      .select('id, pala_id, tienda, texto_original, created_at, palas(nombre, marca, modelo, año)')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw error
    todos = todos.concat(data || [])
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return todos
}

function detectar(aliases) {
  const hallazgos = []
  for (const a of aliases) {
    const p = a.palas
    if (!p) continue
    const texto = a.texto_original

    const vAlias = texto.match(/\b(\d+\.\d+)\b/)?.[1]
    const vPala  = (p.modelo || '').match(/\b(\d+\.\d+)\b/)?.[1]
    if (vAlias && vPala && vAlias !== vPala) {
      hallazgos.push({ tipo: `Versión decimal: alias=${vAlias} pala=${vPala}`, alias: a })
      continue
    }

    const kAlias = kClass(texto), kPala = kClass(p.nombre)
    if (kAlias && kPala && kAlias !== kPala) {
      hallazgos.push({ tipo: `Peso distinto: alias=${kAlias} pala=${kPala}`, alias: a })
      continue
    }

    if (tieneLite(texto) !== tieneLite(p.nombre)) {
      hallazgos.push({ tipo: `Lite: alias=${tieneLite(texto)} pala=${tieneLite(p.nombre)}`, alias: a })
      continue
    }

    const marcaCorrectaPresente = marcaRegex(p.marca).test(texto)
    const marcaDistinta = !marcaCorrectaPresente
      ? MARCAS.find(m => m !== p.marca && marcaRegex(m).test(texto))
      : undefined
    if (marcaDistinta) {
      hallazgos.push({ tipo: `Marca mencionada=${marcaDistinta} (pala.marca=${p.marca})`, alias: a })
      continue
    }

    const añoAlias = añoMencionado(texto)
    if (añoAlias && p.año && Math.abs(añoAlias - p.año) >= 2) {
      hallazgos.push({ tipo: `Año: alias=${añoAlias} pala.año=${p.año}`, alias: a })
      continue
    }
  }
  return hallazgos
}

// ─── Helpers de acción ─────────────────────────────────────────────────────

async function sourceIdDeTienda(tienda) {
  const { data } = await supabase.from('price_sources').select('id').eq('slug', tienda).maybeSingle()
  return data?.id ?? null
}

async function borrarAlias(aliasId) {
  const { data: alias } = await supabase
    .from('producto_aliases').select('id, pala_id, tienda').eq('id', aliasId).maybeSingle()
  if (!alias) throw new Error('Alias no encontrado')

  const sourceId = await sourceIdDeTienda(alias.tienda)
  if (sourceId) {
    await supabase.from('price_snapshots').delete()
      .eq('pala_id', alias.pala_id).eq('source_id', sourceId)
  }
  await supabase.from('producto_aliases').delete().eq('id', aliasId)
}

async function repuntarAlias(aliasId, nuevoPalaId) {
  const { data: alias } = await supabase
    .from('producto_aliases').select('id, pala_id, tienda, texto_normalizado').eq('id', aliasId).maybeSingle()
  if (!alias) throw new Error('Alias no encontrado')

  // Alias: si ya existe uno igual (misma tienda+texto_normalizado) en la pala
  // destino, el nuestro es un duplicado → lo borramos en vez de repuntar.
  const { data: aliasExistente } = await supabase
    .from('producto_aliases').select('id')
    .eq('pala_id', nuevoPalaId).eq('tienda', alias.tienda).eq('texto_normalizado', alias.texto_normalizado)
    .maybeSingle()
  if (aliasExistente) {
    await supabase.from('producto_aliases').delete().eq('id', aliasId)
  } else {
    await supabase.from('producto_aliases').update({ pala_id: nuevoPalaId }).eq('id', aliasId)
  }

  // price_snapshot: mover el de la pala vieja a la nueva (mismo source_id).
  // Si la pala destino ya tiene snapshot de ese source, el viejo se descarta.
  const sourceId = await sourceIdDeTienda(alias.tienda)
  if (sourceId) {
    const { data: snapDestino } = await supabase
      .from('price_snapshots').select('id')
      .eq('pala_id', nuevoPalaId).eq('source_id', sourceId).maybeSingle()
    if (snapDestino) {
      await supabase.from('price_snapshots').delete()
        .eq('pala_id', alias.pala_id).eq('source_id', sourceId)
    } else {
      await supabase.from('price_snapshots').update({ pala_id: nuevoPalaId })
        .eq('pala_id', alias.pala_id).eq('source_id', sourceId)
    }
  }

  // Recalcular precio_pvp de ambas palas (media de snapshots disponibles)
  for (const pid of [alias.pala_id, nuevoPalaId]) {
    const { data: snaps } = await supabase
      .from('price_snapshots').select('precio').eq('pala_id', pid).eq('disponible', true)
    if (snaps && snaps.length > 0) {
      const media = snaps.reduce((s, r) => s + (r.precio ?? 0), 0) / snaps.length
      await supabase.from('palas').update({ precio_pvp: Math.round(media * 100) / 100 }).eq('id', pid)
    }
  }
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function html() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<title>Falsos positivos — Chollo Padel</title>
<style>
*{box-sizing:border-box}
body{font-family:Arial,sans-serif;background:#f4f5f7;margin:0;display:flex;height:100vh;overflow:hidden}
#sidebar{width:340px;min-width:240px;background:#fff;border-right:1px solid #ddd;display:flex;flex-direction:column;overflow:hidden}
#sh{padding:13px 15px;border-bottom:1px solid #eee;background:#f8f9fa}
#sh h1{margin:0 0 3px;font-size:15px}
#sh p{margin:0;font-size:11px;color:#666}
#filtro{padding:8px 12px;border-bottom:1px solid #eee}
#filtro input{width:100%;padding:6px 9px;border:1px solid #ccc;border-radius:5px;font-size:12px}
#lista{flex:1;overflow-y:auto;padding:4px 0}
.gi{padding:9px 13px;cursor:pointer;border-bottom:1px solid #f0f0f0;transition:background .1s}
.gi:hover{background:#f0f4ff}
.gi.activo{background:#e8eeff;border-left:3px solid #4472C4}
.gi.ok{opacity:.4}
.gk{font-weight:600;font-size:11px;word-break:break-word}
.gm{font-size:10px;color:#777;margin-top:2px;word-break:break-word}
.badge{display:inline-block;background:#e74c3c;color:#fff;border-radius:9px;padding:1px 6px;font-size:10px;margin-left:4px;vertical-align:middle}
.badge.v{background:#27ae60}
#main{flex:1;overflow-y:auto;padding:20px}
#aviso{display:none;padding:9px 13px;border-radius:6px;margin-bottom:12px;font-size:13px}
.ok-msg{background:#e8f5e9;border:1px solid #a5d6a7}
.err-msg{background:#ffeaea;border:1px solid #f5a0a0}
#vacio{color:#aaa;text-align:center;margin-top:70px;font-size:14px}
#detalle{display:none;max-width:640px}
#dtipo{display:inline-block;background:#fff3cd;border:1px solid #ffe69c;color:#7a5b00;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;margin-bottom:12px}
.box{background:#fff;border:1px solid #ddd;border-radius:8px;padding:14px;margin-bottom:14px}
.box h3{margin:0 0 6px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.03em}
.box .txt{font-size:14px;line-height:1.4}
.muted{color:#888;font-size:12px;margin-top:4px}
.acciones{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}
button{padding:9px 16px;border:none;border-radius:7px;font-size:13px;cursor:pointer;font-weight:600}
#btn-borrar{background:#e74c3c;color:#fff}
#btn-borrar:hover{background:#c0392b}
#btn-ignorar{background:#fff;color:#555;border:1px solid #ccc}
#btn-ignorar:hover{background:#f5f5f5}
#buscador{margin-top:10px}
#buscador input{width:100%;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px}
#resultados{margin-top:8px;max-height:260px;overflow-y:auto}
.res-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #eee;border-radius:6px;margin-bottom:6px;cursor:pointer}
.res-item:hover{background:#f0f4ff;border-color:#4472C4}
.res-item img{width:38px;height:38px;object-fit:contain;background:#fafafa;border-radius:4px}
.res-n{font-size:12px;font-weight:600}
.res-m{font-size:10px;color:#888}
</style>
</head>
<body>

<div id="sidebar">
  <div id="sh"><h1>Falsos positivos</h1><p>Hallazgos del detector — revisa y actúa</p></div>
  <div id="filtro"><input id="fi" placeholder="Filtrar..." oninput="filtrar(this.value)"/></div>
  <div id="lista"><p style="padding:13px;color:#aaa;font-size:12px">Cargando...</p></div>
</div>

<div id="main">
  <div id="aviso"></div>
  <div id="vacio">← Selecciona un hallazgo para revisar</div>
  <div id="detalle">
    <div id="dtipo"></div>
    <div class="box">
      <h3>Texto original (tienda)</h3>
      <div class="txt" id="dtexto"></div>
      <div class="muted" id="dtienda"></div>
    </div>
    <div class="box">
      <h3>Pala asociada actualmente</h3>
      <div class="txt" id="dpala"></div>
      <div class="muted" id="dpalainfo"></div>
    </div>
    <div class="acciones">
      <button id="btn-borrar" onclick="borrar()">Borrar alias (tienda no debería matchear)</button>
      <button id="btn-ignorar" onclick="ignorar()">Ignorar (es ruido)</button>
    </div>
    <div id="buscador">
      <h3 style="font-size:12px;color:#888;text-transform:uppercase;margin:14px 0 6px">Repuntar a la pala correcta</h3>
      <input id="busq" placeholder="Buscar pala por nombre..." oninput="buscar(this.value)"/>
      <div id="resultados"></div>
    </div>
  </div>
</div>

<script>
let hallazgos=[], actual=null, omitidos=new Set()

async function cargar(){
  const r=await fetch('/api/hallazgos')
  hallazgos=await r.json()
  renderSidebar()
}

function renderSidebar(f=''){
  const fl=f.toLowerCase()
  const vis=hallazgos.filter(h=>!fl||(h.tipo+' '+h.texto_original+' '+h.pala_nombre).toLowerCase().includes(fl))
  const lista=document.getElementById('lista')
  if(!vis.length){lista.innerHTML='<p style="padding:13px;color:#aaa;font-size:12px">Sin resultados</p>';return}
  lista.innerHTML=vis.map(h=>{
    const activo=actual?.alias_id===h.alias_id?' activo':''
    const done=omitidos.has(h.alias_id)?' ok':''
    return \`<div class="gi\${activo}\${done}" data-id="\${h.alias_id}" onclick="sel('\${h.alias_id}')">
      <div class="gk">\${h.tipo}\${done?'<span class="badge v">✓</span>':''}</div>
      <div class="gm">\${h.texto_original}</div>
    </div>\`
  }).join('')
}

function filtrar(v){renderSidebar(v)}

function sel(aliasId){
  actual=hallazgos.find(h=>h.alias_id===aliasId)
  if(!actual)return
  document.getElementById('vacio').style.display='none'
  document.getElementById('detalle').style.display='block'
  document.getElementById('aviso').style.display='none'
  document.getElementById('dtipo').textContent=actual.tipo
  document.getElementById('dtexto').textContent=actual.texto_original
  document.getElementById('dtienda').textContent='tienda: '+actual.tienda+' · alias_id: '+actual.alias_id
  document.getElementById('dpala').textContent=actual.pala_nombre
  document.getElementById('dpalainfo').textContent='marca: '+(actual.pala_marca||'—')+' · modelo: '+(actual.pala_modelo||'—')+' · año: '+(actual.pala_año||'—')+' · pala_id: '+actual.pala_id
  document.getElementById('busq').value=''
  document.getElementById('resultados').innerHTML=''
  renderSidebar(document.getElementById('fi').value)
}

let buscarTimeout=null
function buscar(q){
  clearTimeout(buscarTimeout)
  if(!q||q.length<3){document.getElementById('resultados').innerHTML='';return}
  buscarTimeout=setTimeout(async ()=>{
    const r=await fetch('/api/buscar-pala?q='+encodeURIComponent(q))
    const palas=await r.json()
    const BLANK="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='100%25' height='100%25' fill='%23eee'/%3E%3C/svg%3E"
    document.getElementById('resultados').innerHTML=palas.map(p=>\`
      <div class="res-item" onclick="repuntar('\${p.id}')">
        <img src="\${(p.imagen_url&&!p.imagen_url.startsWith('data:'))?p.imagen_url:BLANK}"/>
        <div>
          <div class="res-n">\${p.nombre}</div>
          <div class="res-m">marca: \${p.marca||'—'} · modelo: \${p.modelo||'—'} · año: \${p.año||'—'}</div>
        </div>
      </div>\`).join('') || '<p style="color:#aaa;font-size:12px">Sin resultados</p>'
  },250)
}

function aviso(ok,msg){
  const av=document.getElementById('aviso')
  av.style.display='block'
  av.className=ok?'ok-msg':'err-msg'
  av.textContent=msg
}

function quitarDeLista(){
  omitidos.add(actual.alias_id)
  hallazgos=hallazgos.filter(h=>h.alias_id!==actual.alias_id)
  actual=null
  document.getElementById('detalle').style.display='none'
  document.getElementById('vacio').style.display='block'
  renderSidebar(document.getElementById('fi').value)
}

async function borrar(){
  if(!actual)return
  if(!confirm('¿Borrar este alias y su price_snapshot? No se puede deshacer.'))return
  const r=await fetch('/api/borrar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({alias_id:actual.alias_id})})
  const resp=await r.json()
  if(resp.ok){aviso(true,'✅ Alias borrado.');quitarDeLista()}
  else aviso(false,'❌ Error: '+(resp.error||'desconocido'))
}

async function repuntar(nuevoPalaId){
  if(!actual)return
  if(!confirm('¿Repuntar este alias a la pala seleccionada?'))return
  const r=await fetch('/api/repuntar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({alias_id:actual.alias_id,nuevo_pala_id:nuevoPalaId})})
  const resp=await r.json()
  if(resp.ok){aviso(true,'✅ Repuntado correctamente.');quitarDeLista()}
  else aviso(false,'❌ Error: '+(resp.error||'desconocido'))
}

function ignorar(){
  if(!actual)return
  quitarDeLista()
}

cargar()
</script>
</body>
</html>`
}

// ─── Servidor ─────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`)

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html())
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/hallazgos') {
      const aliases = await cargarAliases()
      const hallazgos = detectar(aliases).map(h => ({
        tipo: h.tipo,
        alias_id: h.alias.id,
        pala_id: h.alias.pala_id,
        tienda: h.alias.tienda,
        texto_original: h.alias.texto_original,
        pala_nombre: h.alias.palas?.nombre,
        pala_marca: h.alias.palas?.marca,
        pala_modelo: h.alias.palas?.modelo,
        pala_año: h.alias.palas?.año,
      }))
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(hallazgos))
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/buscar-pala') {
      const q = url.searchParams.get('q') || ''
      const { data } = await supabase
        .from('palas').select('id, nombre, marca, modelo, año, imagen_url')
        .ilike('nombre', `%${q}%`).limit(20)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(data || []))
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/borrar') {
      let body = ''
      req.on('data', c => (body += c))
      req.on('end', async () => {
        try {
          const { alias_id } = JSON.parse(body)
          if (!alias_id) throw new Error('Falta alias_id')
          await borrarAlias(alias_id)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/repuntar') {
      let body = ''
      req.on('data', c => (body += c))
      req.on('end', async () => {
        try {
          const { alias_id, nuevo_pala_id } = JSON.parse(body)
          if (!alias_id || !nuevo_pala_id) throw new Error('Faltan parámetros')
          await repuntarAlias(alias_id, nuevo_pala_id)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
      })
      return
    }

    res.writeHead(404); res.end('No encontrado')
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<p>Error: ${e.message}</p>`)
  }
})

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\nYa hay una copia abierta → http://localhost:${PORT}\n`)
    require('child_process').exec(`start http://localhost:${PORT}`)
    setTimeout(() => process.exit(0), 1500)
  } else throw err
})

server.listen(PORT, () => {
  console.log(`\nHerramienta de falsos positivos → http://localhost:${PORT}`)
  console.log('(Deja esta ventana abierta mientras la usas)\n')
  require('child_process').exec(`start http://localhost:${PORT}`)
})
