import { normalizar } from './extract-atributos'
const tests = [
  'ADIDAS WORLD CUP England 2026 (Pala)',
  'ADIDAS WORLD CUP England 2026',
  'BULLPADEL IONIC Power 2025 JAVI LEAL (Pala)',
]
for (const t of tests) console.log(JSON.stringify(t), '->', JSON.stringify(normalizar(t)))
