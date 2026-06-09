/**
 * scripts/fix-duplicados.js
 * =============================================================================
 * Herramienta visual de deduplicación de palas.
 *
 * AGRUPAMIENTO (bag-of-words):
 *   Normaliza el nombre de cada pala → quita jugadores, año y "by" → ordena
 *   los tokens alfabéticamente. Palas con la misma bolsa de palabras son
 *   candidatas a duplicado, independientemente del orden de palabras o de
 *   si una lleva "BY AGUSTÍN TAPIA" y la otra no.
 *
 *   Ejemplo:
 *     "Nox At10 Genius 12K Alum Lite XTREM 2026"
 *     "NOX AT10 GENIUS 12K ALUM XTREM LITE BY AGUSTÍN TAPIA 2026"
 *   → ambas producen la clave: "12k alum at10 genius lite nox xtrem"
 *   → aparecen juntas en la herramienta.
 *
 * UI:
 *   Radio "Canónica" + checkbox "Borrar" independientes por pala.
 *
 * AL FUSIONAR:
 *   price_snapshots + producto_aliases + palas_candidatas → canónica
 *   Las palas marcadas como "borrar" se eliminan.
 *
 * Uso:
 *   node scripts/fix-duplicados.js   (puerto 4546)
 * =============================================================================
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') })
const http = require('http')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
)

const PORT = 4546

// ─── Normalización bag-of-words ───────────────────────────────────────────────

// Tokens individuales de nombres de jugadores — se eliminan palabra a palabra.
// Enfoque por token (no regex de frase) para evitar problemas con variantes de escritura.
const JUGADOR_TOKENS = new Set([
  'ale','galan','galán','juan','lebron','lebrón',
  'arturo','coello','agustin','agustín','tapia',
  'martita','marta','ortega',
  'paquito','pablo','cardona','navarro',
  'tello','alex','ruiz','momo','gonzalez','gonzález','chingotto',
  'franco','stupa','edu','alonso','coki','nieto',
  'gemma','triay','mapi','sanchez','sánchez',
  'carolina','lucia','lucía','sainz',
  'bea','ari','ariana',
  'tino','libaak','aranzazu','osoro',
  'leo','augsburger','miguel','lamperti',
  'jon','sanz','dal','bianco',
  'martin','martín','di','nenno',
  'moyano','yanguas',
  'by',  // preposición que introduce el jugador ("by Agustín Tapia")
])

// Quita acentos y normaliza a minúsculas (U+0300-U+036F explícito).
function normStr(s) {
  if (!s) return ''
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// Normaliza un campo de texto quitando tokens de jugadores.
// Solo alfanumérico, sin jugadores. Para marca/linea/variante usar sin jugadores.
function normCampo(s) {
  if (!s) return ''
  return normStr(s)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .split(' ')
    .filter(w => w.length > 0 && !JUGADOR_TOKENS.has(w))
    .join(' ')
}

// Clave de deduplicación basada en atributos estructurados.
// AÑO se mantiene: "Genius 12K 2024" y "Genius 12K 2025" son productos distintos.
// MODELO se normaliza quitando residuos de jugadores (caso "GENIUS 12K ALUM LITE AGUSTÍN").
// Dos palas con la misma clave son el mismo producto con diferente etiquetado.
function claveNorm(p) {
  const marca    = normCampo(p.marca)
  const linea    = normCampo(p.linea)
  const modelo   = normCampo(p.modelo)   // quita "AGUSTÍN", "BY", etc. del modelo
  const variante = normCampo(p.variante)
  if (!marca || !linea) return ''
  const año = p.año ?? 0  // null → 0 (sin año), agrupa con otros sin año
  return `${marca}|${linea}|${modelo}|${variante}|${año}`
}

// ─── Carga y agrupamiento ─────────────────────────────────────────────────────

async function cargarPalas() {
  const PAGE = 1000
  let todas = [], from = 0
  while (true) {
    const { data, error } = await supabase
      .from('palas')
      .select('id, nombre, slug, marca, linea, modelo, variante, año, fuente, imagen_url, precio_pvp, created_at')
      .order('marca').order('linea').order('año')
      .range(from, from + PAGE - 1)
    if (error) throw error
    todas = todas.concat(data || [])
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return todas
}

function agrupar(palas) {
  const map = new Map()
  for (const p of palas) {
    const clave = claveNorm(p)
    if (!clave) continue
    if (!map.has(clave)) map.set(clave, [])
    map.get(clave).push(p)
  }

  // Fase 2: pala sin año (clave termina en |0) → fusionar con el grupo del mismo
  // marca|linea|modelo|variante que SÍ tiene año. Causa real: algunas tiendas no
  // incluyen el año en el título → extractor guarda año=null → clave distinta.
  for (const [clave, grupo] of [...map.entries()]) {
    if (!clave.endsWith('|0')) continue
    const [m, l, mo, v] = clave.split('|')
    for (const [clave2] of [...map.entries()]) {
      if (clave2 === clave) continue
      const [m2, l2, mo2, v2, a2] = clave2.split('|')
      if (m===m2 && l===l2 && mo===mo2 && v===v2 && /^\d+$/.test(a2) && a2!=='0') {
        map.get(clave2).push(...grupo)
        map.delete(clave)
        break
      }
    }
  }

  // Fase 3: modelo-subconjunto — mismo marca|linea|variante|año, pero los tokens
  // del modelo más corto están todos contenidos en el más largo. Causa real: algunas
  // tiendas escriben "GENIUS 12K" donde el catálogo tiene "Genius 12K Alum".
  const entradas = [...map.entries()]
  const eliminadas = new Set()
  for (let i = 0; i < entradas.length; i++) {
    if (eliminadas.has(entradas[i][0])) continue
    const [c1, g1] = entradas[i]
    const [m1, l1, mo1, v1, a1] = c1.split('|')
    for (let j = i + 1; j < entradas.length; j++) {
      if (eliminadas.has(entradas[j][0])) continue
      const [c2, g2] = entradas[j]
      const [m2, l2, mo2, v2, a2] = c2.split('|')
      if (m1!==m2 || l1!==l2 || v1!==v2 || a1!==a2) continue
      const t1 = mo1.split(' ').filter(Boolean)
      const t2 = mo2.split(' ').filter(Boolean)
      // Subconjunto: todos los tokens del más corto están en el más largo
      const [shortTok, shortKey, shortGrp, longKey, longGrp] =
        t1.length <= t2.length
          ? [t1, c1, g1, c2, g2]
          : [t2, c2, g2, c1, g1]
      if (shortTok.length > 0 && shortTok.every(t => (longKey === c2 ? t2 : t1).includes(t))) {
        map.get(longKey).push(...shortGrp)
        map.delete(shortKey)
        eliminadas.add(shortKey)
      }
    }
  }

  return [...map.entries()]
    .filter(([, g]) => g.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([clave, palas]) => ({ clave, palas }))
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function html() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<title>Deduplicar — Chollo Padel</title>
<style>
*{box-sizing:border-box}
body{font-family:Arial,sans-serif;background:#f4f5f7;margin:0;display:flex;height:100vh;overflow:hidden}
#sidebar{width:320px;min-width:220px;background:#fff;border-right:1px solid #ddd;display:flex;flex-direction:column;overflow:hidden}
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
.gk{font-weight:600;font-size:12px;word-break:break-all}
.gm{font-size:10px;color:#777;margin-top:2px}
.badge{display:inline-block;background:#e74c3c;color:#fff;border-radius:9px;padding:1px 6px;font-size:10px;margin-left:4px;vertical-align:middle}
.badge.v{background:#27ae60}
#main{flex:1;overflow-y:auto;padding:20px}
#aviso{display:none;padding:9px 13px;border-radius:6px;margin-bottom:12px;font-size:13px}
.ok-msg{background:#e8f5e9;border:1px solid #a5d6a7}
.err-msg{background:#ffeaea;border:1px solid #f5a0a0}
#vacio{color:#aaa;text-align:center;margin-top:70px;font-size:14px}
#detalle{display:none}
#dtitulo{margin:0 0 3px;font-size:16px;word-break:break-all}
#dsub{margin:0 0 12px;color:#777;font-size:11px}
.hint{font-size:12px;color:#555;background:#fffde7;border:1px solid #fff176;padding:8px 12px;border-radius:6px;margin-bottom:13px}
.grid{display:flex;flex-wrap:wrap;gap:13px;margin-bottom:18px}
.card{background:#fff;border:2px solid #ddd;border-radius:9px;padding:11px;width:205px;position:relative;transition:border-color .15s}
.card.can{border-color:#4472C4;background:#f0f4ff}
.card.del{border-color:#e74c3c;background:#fff5f5}
.card img{width:100%;height:115px;object-fit:contain;border-radius:5px;background:#fafafa}
.card .cn{font-weight:700;font-size:11px;margin-top:6px;line-height:1.3}
.card .cm{font-size:10px;color:#777;margin-top:2px}
.card .cf{font-size:10px;color:#4472C4;font-weight:700;margin-top:2px}
.card .tg{position:absolute;top:6px;right:6px;font-size:9px;padding:2px 5px;border-radius:6px;font-weight:700}
.tg-can{background:#4472C4;color:#fff}
.tg-del{background:#e74c3c;color:#fff}
.ctrl{display:flex;gap:8px;margin-top:7px}
.ctrl label{font-size:10px;cursor:pointer;display:flex;align-items:center;gap:3px}
.acciones{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#btn-f{padding:9px 22px;background:#4472C4;color:#fff;border:none;border-radius:7px;font-size:14px;cursor:pointer;font-weight:600}
#btn-f:hover:not(:disabled){background:#35589a}
#btn-f:disabled{background:#bbb;cursor:not-allowed}
#btn-o{padding:9px 14px;background:#fff;color:#555;border:1px solid #ccc;border-radius:7px;font-size:12px;cursor:pointer}
#btn-o:hover{background:#f5f5f5}
#resumen{font-size:12px;color:#555}
</style>
</head>
<body>

<div id="sidebar">
  <div id="sh"><h1>Deduplicar palas</h1><p>Mismo nombre normalizado (sin jugador, sin año)</p></div>
  <div id="filtro"><input id="fi" placeholder="Filtrar grupos..." oninput="filtrar(this.value)"/></div>
  <div id="lista"><p style="padding:13px;color:#aaa;font-size:12px">Cargando...</p></div>
</div>

<div id="main">
  <div id="aviso"></div>
  <div id="vacio">← Selecciona un grupo para revisar</div>
  <div id="detalle">
    <h2 id="dtitulo"></h2>
    <p id="dsub"></p>
    <div class="hint">
      Marca <strong>Canónica</strong> (radio) en la pala que quieres conservar.<br>
      Marca <strong>Borrar</strong> (checkbox) en las que son duplicados reales.<br>
      Puedes borrar solo algunas — las no marcadas se quedan intactas.
    </div>
    <div class="grid" id="grid"></div>
    <div class="acciones">
      <button id="btn-f" onclick="fusionar()" disabled>Fusionar</button>
      <button id="btn-o" onclick="omitir()">Omitir</button>
      <span id="resumen"></span>
    </div>
  </div>
</div>

<script>
let grupos=[], grupoActual=null, omitidos=new Set(), estado={}

async function cargar(){
  const r=await fetch('/api/grupos')
  grupos=await r.json()
  renderSidebar()
}

function renderSidebar(f=''){
  const fl=f.toLowerCase()
  const vis=grupos.filter(g=>!fl||g.clave.includes(fl))
  const lista=document.getElementById('lista')
  if(!vis.length){lista.innerHTML='<p style="padding:13px;color:#aaa;font-size:12px">Sin resultados</p>';return}
  lista.innerHTML=vis.map(g=>{
    const activo=grupoActual?.clave===g.clave?' activo':''
    const done=omitidos.has(g.clave)?' ok':''
    const bCls=done?'v':'', bTxt=done?'✓':g.palas.length
    return \`<div class="gi\${activo}\${done}" data-clave="\${g.clave.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}" onclick="sel(this.dataset.clave)">
      <div class="gk">\${g.clave}<span class="badge \${bCls}">\${bTxt}</span></div>
      <div class="gm">\${g.palas.map(p=>(p.año||'s/año')+' '+p.fuente).join(' · ')}</div>
    </div>\`
  }).join('')
}

function filtrar(v){renderSidebar(v)}

function sel(clave){
  grupoActual=grupos.find(g=>g.clave===clave)
  if(!grupoActual)return
  estado={}
  for(const p of grupoActual.palas) estado[p.id]='keep'
  // Auto-sugerencia: pala con año → canónica; sin año (edición jugador) → borrar
  const conAnio=grupoActual.palas.filter(p=>p.año)
  const sinAnio=grupoActual.palas.filter(p=>!p.año)
  if(conAnio.length===1&&sinAnio.length===1){
    estado[conAnio[0].id]='canonical'
    estado[sinAnio[0].id]='delete'
  }
  document.getElementById('vacio').style.display='none'
  document.getElementById('detalle').style.display='block'
  document.getElementById('aviso').style.display='none'
  renderGrupo()
  renderSidebar(document.getElementById('fi').value)
}

function setEstado(id,val){
  if(val==='canonical') for(const k in estado) if(estado[k]==='canonical') estado[k]='keep'
  estado[id]=val
  renderGrupo()
}

const BLANK="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100%25' height='100%25' fill='%23eee'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23aaa' font-size='11'%3Esin foto%3C/text%3E%3C/svg%3E"

function renderGrupo(){
  if(!grupoActual)return
  document.getElementById('dtitulo').textContent=grupoActual.clave
  document.getElementById('dsub').textContent=
    grupoActual.palas.length+' palas · '+grupoActual.palas.map(p=>p.nombre).join(' / ')
  document.getElementById('grid').innerHTML=grupoActual.palas.map(p=>{
    const est=estado[p.id]||'keep'
    const cls=est==='canonical'?' can':est==='delete'?' del':''
    const tag=est==='canonical'?'<span class="tg tg-can">CONSERVAR</span>':
              est==='delete'?'<span class="tg tg-del">BORRAR</span>':''
    const img=p.imagen_url&&!p.imagen_url.startsWith('data:')?p.imagen_url:BLANK
    const pvp=p.precio_pvp?p.precio_pvp.toFixed(2)+' €':'—'
    const isCan=est==='canonical', isDel=est==='delete'
    return \`<div class="card\${cls}">
      \${tag}
      <img src="\${img}" alt=""/>
      <div class="cn">\${p.nombre}</div>
      <div class="cm">modelo: \${p.modelo||'—'} · var: \${p.variante||'—'}</div>
      <div class="cm">año: \${p.año||'—'} · pvp: \${pvp}</div>
      <div class="cf">\${p.fuente||'?'}</div>
      <div class="ctrl">
        <label><input type="radio" \${isCan?'checked':''} onchange="setEstado('\${p.id}','canonical')"> Canónica</label>
        <label><input type="checkbox" \${isDel?'checked':''} onchange="setEstado('\${p.id}',this.checked?'delete':'keep')"> Borrar</label>
      </div>
    </div>\`
  }).join('')
  actualizarBtn()
}

function actualizarBtn(){
  const nCan=Object.values(estado).filter(v=>v==='canonical').length
  const nDel=Object.values(estado).filter(v=>v==='delete').length
  document.getElementById('btn-f').disabled=!(nCan===1&&nDel>=1)
  document.getElementById('resumen').textContent=
    nCan===1&&nDel>=1?\`Conserva 1 · Borra \${nDel}\`:'Elige 1 canónica y marca las que borrar'
}

async function fusionar(){
  const canonicaId=Object.keys(estado).find(id=>estado[id]==='canonical')
  const mergeIds=Object.keys(estado).filter(id=>estado[id]==='delete')
  if(!canonicaId||!mergeIds.length)return
  document.getElementById('btn-f').disabled=true
  const r=await fetch('/api/fusionar',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({canonical_id:canonicaId,merge_ids:mergeIds})
  })
  const resp=await r.json()
  const av=document.getElementById('aviso')
  av.style.display='block'
  if(resp.ok){
    av.className='ok-msg'
    av.textContent=\`✅ Fusionado. \${mergeIds.length} pala(s) eliminada(s).\`
    omitidos.add(grupoActual.clave)
    grupos=grupos.filter(g=>g.clave!==grupoActual.clave)
    grupoActual=null
    document.getElementById('detalle').style.display='none'
    document.getElementById('vacio').style.display='block'
    renderSidebar(document.getElementById('fi').value)
  }else{
    av.className='err-msg'
    av.textContent='❌ Error: '+(resp.error||'desconocido')
    document.getElementById('btn-f').disabled=false
  }
}

function omitir(){
  if(!grupoActual)return
  omitidos.add(grupoActual.clave)
  grupoActual=null
  document.getElementById('detalle').style.display='none'
  document.getElementById('vacio').style.display='block'
  renderSidebar(document.getElementById('fi').value)
}

cargar()
</script>
</body>
</html>`
}

// ─── Servidor ─────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html())
      return
    }

    if (req.method === 'GET' && req.url === '/api/grupos') {
      const palas  = await cargarPalas()
      const grupos = agrupar(palas)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(grupos))
      return
    }

    if (req.method === 'POST' && req.url === '/api/fusionar') {
      let body = ''
      req.on('data', c => (body += c))
      req.on('end', async () => {
        try {
          const { canonical_id, merge_ids } = JSON.parse(body)
          if (!canonical_id || !merge_ids?.length) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Parámetros inválidos' }))
            return
          }

          for (const mid of merge_ids) {
            await supabase.from('price_snapshots')
              .update({ pala_id: canonical_id }).eq('pala_id', mid)

            const { data: aliases } = await supabase
              .from('producto_aliases').select('id, tienda, texto_normalizado').eq('pala_id', mid)
            for (const a of (aliases || [])) {
              const { data: existe } = await supabase
                .from('producto_aliases').select('id')
                .eq('pala_id', canonical_id)
                .eq('tienda', a.tienda)
                .eq('texto_normalizado', a.texto_normalizado)
                .maybeSingle()
              if (existe) {
                await supabase.from('producto_aliases').delete().eq('id', a.id)
              } else {
                await supabase.from('producto_aliases')
                  .update({ pala_id: canonical_id }).eq('id', a.id)
              }
            }

            const { data: cands } = await supabase
              .from('palas_candidatas').select('id, datos_extraidos')
              .contains('datos_extraidos', { pala_id_promovida: mid })
            for (const c of (cands || [])) {
              const d = c.datos_extraidos || {}
              await supabase.from('palas_candidatas')
                .update({ datos_extraidos: { ...d, pala_id_promovida: canonical_id } })
                .eq('id', c.id)
            }

            await supabase.from('palas').delete().eq('id', mid)
          }

          // Recalcular precio_pvp del canónico como media de sus price_snapshots activos
          const { data: snaps } = await supabase
            .from('price_snapshots')
            .select('precio')
            .eq('pala_id', canonical_id)
            .eq('disponible', true)
          if (snaps && snaps.length > 0) {
            const media = snaps.reduce((s, r) => s + (r.precio ?? 0), 0) / snaps.length
            await supabase.from('palas')
              .update({ precio_pvp: Math.round(media * 100) / 100 })
              .eq('id', canonical_id)
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
      })
      return
    }

    // Debug: muestra nombre + clave normalizada de todas las palas de una marca
    // Uso: http://localhost:4546/api/debug?marca=Nox
    if (req.method === 'GET' && req.url?.startsWith('/api/debug')) {
      const marca = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('marca') || ''
      const palas = await cargarPalas()
      const filtradas = marca ? palas.filter(p => p.marca?.toLowerCase() === marca.toLowerCase()) : palas
      const resultado = filtradas.map(p => ({
        id: p.id,
        nombre: p.nombre,
        marca: p.marca, linea: p.linea, modelo: p.modelo, variante: p.variante,
        clave: claveNorm(p),
        año: p.año,
        fuente: p.fuente,
      }))
      // Agrupar para mostrar las que coinciden
      const porClave = {}
      for (const r of resultado) {
        const k = r.clave
        if (!k) continue
        porClave[k] = porClave[k] || []
        porClave[k].push(r)
      }
      const duplicados = Object.entries(porClave).filter(([, v]) => v.length > 1)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ total: filtradas.length, duplicados_detectados: duplicados.length, duplicados, todos: resultado }, null, 2))
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
  console.log(`\nHerramienta de duplicados → http://localhost:${PORT}`)
  console.log('(Deja esta ventana abierta mientras la usas)\n')
  require('child_process').exec(`start http://localhost:${PORT}`)
})
