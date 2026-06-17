import { extraerAtributos } from './extract-atributos'

const casos = [
  'Nox At10 Genius 12K Alum Lite XTREM 2026',
  'NOX AT10 GENIUS 12K ALUM XTREM LITE BY AGUSTÍN TAPIA 2026',
  'Nox At10 Genius 12K Alum Xtrem ATTACK 2026',
  'NOX AT10 GENIUS ATTACK 12K ALUM XTREM BY AGUSTÍN TAPIA',
]

for (const t of casos) {
  const r = extraerAtributos(t)
  console.log(t)
  console.log(`  → ${r.marca} | ${r.linea} | modelo="${r.modelo}" | var=${r.variante} | año=${r.año}`)
}
