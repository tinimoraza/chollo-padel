import { extraerAtributos } from './extract-atributos'
const casos = [
  'NOX ML10 PRO CUP ROUGH SURFACE EDITION 23',
  'VIBORA NAYA LIQUID EDITION 2023',
  'STAR VIE AQUILA BLUE EDITION TOUR 2024',
]
for (const t of casos) {
  const a = extraerAtributos(t)
  console.log(`INPUT: ${t}`)
  console.log(`  modelo="${a.modelo}" variante="${a.variante}" año=${a.año}`)
}
