// Detección de marca a partir del título del anuncio
// Compartida por scrape-wallapop.ts y scrape-vinted.ts

const MARCAS = [
  { regex: /bullpadel/i,          marca: 'Bullpadel' },
  { regex: /adidas/i,             marca: 'Adidas' },
  { regex: /babolat/i,            marca: 'Babolat' },
  { regex: /\bnox\b/i,            marca: 'Nox' },
  { regex: /\bhead\b/i,           marca: 'Head' },
  { regex: /wilson/i,             marca: 'Wilson' },
  { regex: /siux/i,               marca: 'Siux' },
  { regex: /vibora/i,             marca: 'Vibora' },
  { regex: /star.?vie/i,          marca: 'Starvie' },
  { regex: /drop.?shot/i,         marca: 'Drop Shot' },
  { regex: /royal.?padel/i,       marca: 'Royal Padel' },
  { regex: /kuikma/i,             marca: 'Kuikma' },
  { regex: /varlion/i,            marca: 'Varlion' },
  { regex: /black.?crown/i,       marca: 'Black Crown' },
  { regex: /dunlop/i,             marca: 'Dunlop' },
  { regex: /enebe/i,              marca: 'Enebe' },
  { regex: /oxdog/i,              marca: 'Oxdog' },
  { regex: /\bpuma\b/i,           marca: 'Puma' },
  { regex: /akkeron/i,            marca: 'Akkeron' },
  { regex: /\bjoma\b/i,           marca: 'Joma' },
  { regex: /kombat/i,             marca: 'Kombat' },
  { regex: /\blok\b/i,            marca: 'Lok' },
  { regex: /alkemia/i,            marca: 'Alkemia' },
  { regex: /softee/i,             marca: 'Softee' },
  { regex: /kelme/i,              marca: 'Kelme' },
  { regex: /vairo/i,              marca: 'Vairo' },
  { regex: /ocho.?padel/i,        marca: 'Ocho Padel' },
]

export function detectarMarca(title: string, keyword?: string): string | null {
  // 1. Intentar detectar desde el título
  for (const { regex, marca } of MARCAS) {
    if (regex.test(title)) return marca
  }
  // 2. Fallback: detectar desde la keyword (cubre casos donde el título no menciona la marca)
  if (keyword) {
    for (const { regex, marca } of MARCAS) {
      if (regex.test(keyword)) return marca
    }
  }
  return null
}
