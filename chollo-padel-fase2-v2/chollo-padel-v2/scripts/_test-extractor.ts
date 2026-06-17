import { extraerAtributos } from './extract-atributos'
const tests = [
  'BULLPADEL IONIC Power 2025 JAVI LEAL',
  'BULLPADEL IONIC Control 2025',
  'BULLPADEL IONIC Light 2026',
  'ADIDAS WORLD CUP England 2026',
  'ADIDAS WORLD CUP Spain 2026',
  'NOX FUTURE Hybrid 12K NFA Series 2025',
  'BULLPADEL FLOW LEGEND 2026 ALEJANDRA SALAZAR',
]
for (const t of tests) {
  const r = extraerAtributos(t)
  console.log(`${t}\n  → marca=${r.marca} linea=${r.linea} modelo=${r.modelo} variante=${r.variante} año=${r.año}\n`)
}
