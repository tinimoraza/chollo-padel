import { extraerAtributos } from './extract-atributos'
const tests = [
  'BULLPADEL ICON 2025 JUAN MARTÍN DÍAZ (Pala)',
  'BULLPADEL ELITE W 2026 GEMMA TRIAY (Pala)',
  'BULLPADEL ELITE W Tour Final 2025 GEMMA TRIAY (Pala)',
  'BULLPADEL XPLO 2025 DI NENNO (Pala)',
  'BULLPADEL XPLO 2026 MARTIN DI NENNO (Pala)',
  'BULLPADEL VERTEX 05 HYB 2026 (Pala)',
  'BULLPADEL HACK 04 HYB 2026 PAQUITO NAVARRO (Pala)',
  'BULLPADEL INDIGA PWR 2025 (Pala)',
  'BULLPADEL INDIGA W 2025 (Pala)',
]
for (const t of tests) {
  const r = extraerAtributos(t)
  console.log(`${t}\n  → modelo=${JSON.stringify(r.modelo)} variante=${r.variante} año=${r.año}\n`)
}
