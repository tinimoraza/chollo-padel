import { extraerAtributos } from './extract-atributos.ts'
const titulos = [
  "Adidas Crossit Light 2026",
  "Head Vive 2026 Verde Naranja",
  "Vibora King Kobra Classic Edition",
  "Adidas Cross It 3.4 2025",
  "Head Vibe 2025 Gris/Negro",
  "Vibor-a Yarara Pro White 2025",
]
for (const t of titulos) {
  console.log(t, '->', JSON.stringify(extraerAtributos(t)))
}
