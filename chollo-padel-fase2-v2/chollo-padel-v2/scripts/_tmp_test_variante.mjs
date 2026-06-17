// TEMP TEST FILE - safe to delete
function normalizar(s) {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const VARIANTES = ['hrd+', 'hrd', 'ctrl', 'control', 'light']
const VARIANTES_ALIAS = {
  'hrd+': 'HRD+', 'hrd': 'HRD',
  'ctrl': 'CTRL', 'control': 'CTRL',
}

const sinLinea = 'HRD+ 3.4'
const sinLineaNorm = normalizar(sinLinea)
console.log('sinLineaNorm =', JSON.stringify(sinLineaNorm))

const sorted = [...VARIANTES].sort((a,b)=> b.length - a.length)
console.log('sorted order =', sorted)

let varianteDetectada = null
for (const v of sorted) {
  const vNorm = normalizar(v)
  console.log(`checking v=${JSON.stringify(v)} vNorm=${JSON.stringify(vNorm)} includes=${sinLineaNorm.includes(vNorm)}`)
  if (sinLineaNorm.includes(vNorm)) {
    varianteDetectada = VARIANTES_ALIAS[v] ?? VARIANTES_ALIAS[vNorm] ?? v.toUpperCase()
    console.log(' -> MATCHED, varianteDetectada =', varianteDetectada)
    break
  }
}
console.log('FINAL varianteDetectada =', varianteDetectada)
