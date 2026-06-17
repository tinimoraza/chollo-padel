// Herramienta visual para arreglar imágenes de palas con placeholder.
// Uso: node scripts/fix-imagenes.js   (o doble clic en el acceso directo del escritorio)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') })
const http = require('http')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
)

const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgo'
const PORT = 4545

function pagina(palas, mensaje) {
  const filas = palas.map(p => `
    <div class="card">
      <img src="${p.imagen_url || ''}" class="preview-actual" onerror="this.style.opacity=0.2" />
      <div class="info">
        <div class="nombre">${p.nombre}</div>
        <div class="marca">${p.marca || ''}</div>
        <form method="POST" action="/guardar">
          <input type="hidden" name="id" value="${p.id}" />
          <input type="text" name="url" placeholder="Pega aquí la URL de la imagen nueva" oninput="document.getElementById('prev-${p.id}').src = this.value" />
          <img id="prev-${p.id}" class="preview-nueva" />
          <button type="submit">Guardar</button>
        </form>
      </div>
    </div>`).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Arreglar imágenes — Chollo Padel</title>
<style>
  body { font-family: Arial, sans-serif; background:#f4f5f7; margin:0; padding:24px; }
  h1 { font-size:20px; }
  .aviso { background:#e8f5e9; border:1px solid #a5d6a7; padding:10px 14px; border-radius:6px; margin-bottom:16px; }
  .card { display:flex; gap:16px; align-items:center; background:#fff; border:1px solid #ddd; border-radius:8px; padding:14px; margin-bottom:12px; }
  .preview-actual, .preview-nueva { width:70px; height:70px; object-fit:contain; border:1px solid #eee; border-radius:6px; background:#fafafa; }
  .info { flex:1; }
  .nombre { font-weight:bold; }
  .marca { color:#777; font-size:13px; margin-bottom:8px; }
  form { display:flex; gap:10px; align-items:center; }
  input[type=text] { flex:1; padding:8px; border:1px solid #ccc; border-radius:6px; }
  button { padding:8px 16px; background:#4472C4; color:#fff; border:none; border-radius:6px; cursor:pointer; }
  button:hover { background:#35589a; }
  .vacio { color:#777; }
</style>
</head>
<body>
  <h1>Palas con imagen sin foto (${palas.length})</h1>
  ${mensaje ? `<div class="aviso">${mensaje}</div>` : ''}
  ${palas.length === 0 ? '<p class="vacio">No hay ninguna pendiente. Todo arreglado 🎉</p>' : filas}
</body>
</html>`
}

async function listarPendientes() {
  // Pendiente = placeholder base64 O sin imagen_url (null/vacío).
  // OJO: or() de Supabase no soporta bien comodines con caracteres especiales (':' en
  // 'data:image/...'), así que hacemos dos queries por separado y las combinamos.
  const [placeholder, sinImagen] = await Promise.all([
    supabase.from('palas').select('id, nombre, marca, imagen_url').ilike('imagen_url', `${PLACEHOLDER}%`),
    supabase.from('palas').select('id, nombre, marca, imagen_url').or('imagen_url.is.null,imagen_url.eq.'),
  ])
  if (placeholder.error) throw placeholder.error
  if (sinImagen.error) throw sinImagen.error
  return [...placeholder.data, ...sinImagen.data].sort((a, b) => a.nombre.localeCompare(b.nombre))
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      const palas = await listarPendientes()
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(pagina(palas))
      return
    }

    if (req.method === 'POST' && req.url === '/guardar') {
      let body = ''
      req.on('data', c => (body += c))
      req.on('end', async () => {
        const params = new URLSearchParams(body)
        const id = params.get('id')
        const url = (params.get('url') || '').trim()
        if (!id || !url) {
          const palas = await listarPendientes()
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(pagina(palas, 'Falta la URL — no se ha guardado nada.'))
          return
        }
        const { error } = await supabase.from('palas').update({ imagen_url: url }).eq('id', id)
        const palas = await listarPendientes()
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(pagina(palas, error ? `Error al guardar: ${error.message}` : 'Imagen guardada ✅'))
      })
      return
    }

    res.writeHead(404)
    res.end('No encontrado')
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<p>Error: ${e.message}</p>`)
  }
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\nYa había una copia de la herramienta abierta. Abriendo el navegador en http://localhost:${PORT} ...\n`)
    require('child_process').exec(`start http://localhost:${PORT}`)
    setTimeout(() => process.exit(0), 1500)
  } else {
    throw err
  }
})

server.listen(PORT, () => {
  console.log(`\nHerramienta de imágenes lista → http://localhost:${PORT}\n(Deja esta ventana abierta mientras la usas. Ciérrala cuando termines.)\n`)
  require('child_process').exec(`start http://localhost:${PORT}`)
})
