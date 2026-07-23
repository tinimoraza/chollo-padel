/**
 * scripts/top-oportunidades.ts
 * ==============================
 * Genera el Top 10 global de oportunidades de segunda mano.
 * LOGICA v3: frase exacta + exclusiones con regex word-boundary.
 *
 * Ejecutar manualmente:
 *   npx tsx --env-file=.env.local scripts/top-oportunidades.ts
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const MIN_PRICE             = 30
const MIN_ITEMS_FOR_MEDIANA = 5
const THRESHOLD_OPORTUNIDAD = 0.75
const TOP_N                 = 40
const VERIFY_THROTTLE       = 250

const CONDICIONES_TOP = ['new', 'un_opened', 'as_good_as_new']

// Bonus de score para anuncios NUEVOS (sube posiciones en el TOP respecto a casi-nuevos)
const BONUS_NEW = 8

// Penalización progresiva por antigüedad del anuncio (campo date de wallapop_cache)
// Umbrales en días → penalización acumulada (se aplica el primero que se cumple)
const PEN_ANTIGÜEDAD: Array<[number, number]> = [
  [45, -60],
  [30, -40],
  [21, -25],
  [14, -15],
  [ 7,  -5],
]

function calcularPenAntiguedad(dateStr: string | null): number {
  if (!dateStr) return 0
  const dias = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
  for (const [umbral, pen] of PEN_ANTIGÜEDAD) {
    if (dias > umbral) return pen
  }
  return 0
}

// ── Sistema de rating multifactor ────────────────────────────────────────────
// Peso ahorro absoluto: cada 10€ ahorrados = 1 punto
const PESO_AHORRO_EUROS = 0.10

// Bonus/penalización por año del modelo (extraído del nombre del catálogo)
// Años modernos suman; años viejos restan para evitar que palas obsoletas
// aparezcan en el top solo por tener precio bajo en wallapop vs precio de
// referencia (que puede ser el precio antiguo de una tienda con stock residual).
const BONUS_AÑO: Record<number, number> = {
  2026: 10,
  2025: 5,
  2024: 2,
  2023: -5,
  2022: -15,
  2021: -20,
}
const PENALIZACION_SIN_AÑO = -10   // Sin año resta más: el modelo es incierto

function extraerAñoModelo(nombreModelo: string): number | null {
  const m = nombreModelo.match(/\b(20\d{2})\b/)
  return m ? parseInt(m[1], 10) : null
}

function calcularBonusAño(nombreModelo: string): number {
  const año = extraerAñoModelo(nombreModelo)
  if (año === null) return PENALIZACION_SIN_AÑO
  return BONUS_AÑO[año] ?? -25   // 2020 o anterior → penalización máxima
}

const EXCLUIR_SIEMPRE_RE: RegExp[] = [
  /\bjunior\b/i,
  /\bj\.?r\.?\b/i,
  /\binfantil\b/i,
  /\bni[\xf1n][oa]\b/i,
  /\byouth\b/i,
  /\bkids?\b/i,
  /\breparar\b/i,
  /\breparaci[o\xf3]n\b/i,
  /\breparad[ao]\b/i,
  /\bpara piezas\b/i,
  /\brot[ao]\b/i,
  /\bda[\xf1n]ad[ao]\b/i,
  /\bfisura\b/i,
  /\bcrack\b/i,
  /\bgolpe\b/i,
  /\bno funciona\b/i,
  /\btenis\b/i,
  /\btest\b/i,
  // Accesorios que no son palas
  /\bmochila\b/i,
  /\bpaletero\b/i,
  /\bbolsa\b/i,
  /\bfunda\b/i,
  /\bgrip\b/i,
  /\bovergrip\b/i,
  /\bprotector\b/i,
  /\bmu[\xf1n]equera\b/i,
  /\bvisera\b/i,
  /\bgorra\b/i,
  /\bpelota(s)?\b/i,
  /\bzapatilla(s)?\b/i,
  /\bcamiseta\b/i,
  /\bpantalon\b/i,
  /\bshort\b/i,
]

interface Modelo {
  nombre: string
  phrase: string
  excludeKeywords?: string[]
}

const MODELOS: Modelo[] = [
  // Bullpadel
  { nombre: 'Bullpadel Vertex 02 2024',           phrase: 'vertex 02 2024' },
  { nombre: 'Bullpadel Vertex 04',                phrase: 'vertex 04' },
  { nombre: 'Bullpadel Vertex 05',                phrase: 'vertex 05',                excludeKeywords: ['comfort'] },
  { nombre: 'Bullpadel Vertex 05 Comfort 2026',   phrase: 'vertex 05 comfort' },
  { nombre: 'Bullpadel Hack 04',                  phrase: 'hack 04',                  excludeKeywords: ['hybrid','paquito'] },
  { nombre: 'Bullpadel Hack 04 Hybrid',           phrase: 'hack 04 hybrid' },
  { nombre: 'Bullpadel Neuron 02 2024',           phrase: 'neuron 2024',              excludeKeywords: ['edge','chingotto'] },
  { nombre: 'Bullpadel Neuron 02 2024',           phrase: 'neuron 24',                excludeKeywords: ['edge','chingotto'] },
  { nombre: 'Bullpadel Neuron 02 2025',           phrase: 'neuron 2025',              excludeKeywords: ['edge','chingotto'] },
  { nombre: 'Bullpadel Neuron 02 2025',           phrase: 'neuron 25',                excludeKeywords: ['edge','chingotto'] },
  { nombre: 'Bullpadel Neuron 02 2026',           phrase: 'neuron 02 2026',           excludeKeywords: ['edge','chingotto'] },
  { nombre: 'Bullpadel Neuron 02 Edge 2026',      phrase: 'neuron 02 edge 2026' },
  { nombre: 'Bullpadel Neuron 02 Chingotto 2026', phrase: 'neuron 02 chingotto 2026' },
  { nombre: 'Bullpadel Neuron Cloud 2026',        phrase: 'neuron cloud' },
  { nombre: 'Bullpadel Pearl 2026',               phrase: 'pearl 2026' },
  { nombre: 'Bullpadel Sniper 2.0 CTR',           phrase: 'sniper 2.0 ctr' },
  { nombre: 'Bullpadel Sniper 2.0 PWR',           phrase: 'sniper 2.0 pwr' },
  { nombre: 'Bullpadel XPLO 2026',                phrase: 'bullpadel xplo 2026' },
  { nombre: 'Bullpadel Ionic Power 2025',         phrase: 'ionic power 2025' },
  { nombre: 'Bullpadel Ionic Power 2026',         phrase: 'ionic power 2026' },

  // Head
  { nombre: 'Head Radical Pro 2024',              phrase: 'radical pro 2024' },
  { nombre: 'Head Radical Motion 2024',           phrase: 'radical motion 2024' },
  { nombre: 'Head Radical Elite 2024',            phrase: 'radical elite 2024' },
  { nombre: 'Head Radical Pro 2026',              phrase: 'radical pro 2026' },
  { nombre: 'Head Radical Motion 2026',           phrase: 'radical motion 2026' },
  { nombre: 'Head Radical Team 2026',             phrase: 'radical team 2026',        excludeKeywords: ['light'] },
  { nombre: 'Head Radical Team Light 2026',       phrase: 'radical team light' },
  { nombre: 'Head Speed Pro 2025',                phrase: 'speed pro 2025' },
  { nombre: 'Head Speed Pro 2026',                phrase: 'speed pro 2026' },
  { nombre: 'Head Speed Motion 2025',             phrase: 'speed motion 2025' },
  { nombre: 'Head Speed One X 2025',              phrase: 'speed one x 2025' },
  { nombre: 'Head Coello Pro 2025',               phrase: 'coello pro 2025' },
  { nombre: 'Head Coello Pro 2026',               phrase: 'coello pro 2026' },
  { nombre: 'Head Coello Motion 2025',            phrase: 'coello motion 2025' },
  { nombre: 'Head Coello Motion 2026',            phrase: 'coello motion 2026' },
  { nombre: 'Head Extreme Motion 2025',           phrase: 'extreme motion 2025' },
  { nombre: 'Head Extreme Pro 2025',              phrase: 'extreme pro 2025' },
  { nombre: 'Head Extreme Pro 2026',              phrase: 'extreme pro 2026' },
  { nombre: 'Head Gravity Team 2025',             phrase: 'gravity team 2025' },

  // Babolat
  { nombre: 'Babolat Technical Viper 3.0',              phrase: 'technical viper 3.0',          excludeKeywords: ['soft'] },
  { nombre: 'Babolat Technical Viper Soft 3.0',         phrase: 'technical viper soft 3.0' },
  { nombre: 'Babolat Technical Viper 2025',             phrase: 'technical viper 2025',         excludeKeywords: ['soft','lebron'] },
  { nombre: 'Babolat Technical Viper 2026',             phrase: 'technical viper 2026',         excludeKeywords: ['soft','lebron'] },
  { nombre: 'Babolat Technical Viper Lebron 2026',      phrase: 'technical viper lebron 2026',  excludeKeywords: ['soft'] },
  { nombre: 'Babolat Technical Viper Soft Lebron 2026', phrase: 'technical viper soft lebron 2026' },
  { nombre: 'Babolat Counter Viper 2025',               phrase: 'counter viper 2025' },
  { nombre: 'Babolat Counter Viper 2026',               phrase: 'counter viper 2026' },
  { nombre: 'Babolat Air Viper 2025',                   phrase: 'air viper 2025' },
  { nombre: 'Babolat Air Viper 2026',                   phrase: 'air viper 2026' },
  { nombre: 'Babolat Air Vertuo 2026',                  phrase: 'air vertuo 2026' },
  { nombre: 'Babolat Viper Juan Lebron 3.0',            phrase: 'viper juan lebron 3.0' },
  { nombre: 'Babolat Viper Juan Lebron 2025',           phrase: 'viper juan lebron 2025' },
  { nombre: 'Babolat Viper Juan Lebron 2026',           phrase: 'viper juan lebron 2026' },

  // Nox
  { nombre: 'Nox AT10 18K 2024',                  phrase: 'at10 18k 2024',            excludeKeywords: ['genius','attack'] },
  { nombre: 'Nox AT10 18K 2025',                  phrase: 'at10 18k 2025',            excludeKeywords: ['genius','attack'] },
  { nombre: 'Nox AT10 18K 2026',                  phrase: 'at10 18k 2026',            excludeKeywords: ['genius','attack'] },
  { nombre: 'Nox AT10 12K 2024',                  phrase: 'at10 12k 2024',            excludeKeywords: ['genius','attack','lite'] },
  { nombre: 'Nox AT10 12K 2025',                  phrase: 'at10 12k 2025',            excludeKeywords: ['genius','attack','lite'] },
  { nombre: 'Nox AT10 12K 2026',                  phrase: 'at10 12k 2026',            excludeKeywords: ['genius','attack','lite'] },
  { nombre: 'Nox AT10 12K Lite 2026',             phrase: 'at10 12k lite 2026' },
  { nombre: 'Nox AT10 18K Attack 2026',           phrase: 'at10 18k attack 2026' },
  { nombre: 'Nox AT10 12K Attack 2026',           phrase: 'at10 12k attack 2026' },
  { nombre: 'Nox AT10 Genius 18K 2025',           phrase: 'at10 genius 18k 2025',     excludeKeywords: ['attack'] },
  { nombre: 'Nox AT10 Genius 18K 2025',           phrase: 'at10 genius 18k alum',     excludeKeywords: ['attack'] }, // "ALUM BY AGUSTIN TAPIA" rompe la frase con año
  { nombre: 'Nox AT10 Genius 18K 2026',           phrase: 'at10 genius 18k 2026',     excludeKeywords: ['attack'] },
  { nombre: 'Nox AT10 Genius 12K 2025',           phrase: 'at10 genius 12k 2025',     excludeKeywords: ['attack'] },
  { nombre: 'Nox AT10 Genius 12K 2025',           phrase: 'at10 genius 12k alum',     excludeKeywords: ['attack'] },
  { nombre: 'Nox AT10 Genius 12K 2026',           phrase: 'at10 genius 12k 2026',     excludeKeywords: ['attack'] },
  { nombre: 'Nox AT10 Genius Attack 18K 2025',    phrase: 'at10 genius attack 18k 2025' },
  { nombre: 'Nox AT10 Genius Attack 18K 2026',    phrase: 'at10 genius attack 18k 2026' },
  { nombre: 'Nox AT10 Genius Attack 12K 2025',    phrase: 'at10 genius attack 12k 2025' },
  { nombre: 'Nox AT10 Genius Attack 12K 2026',    phrase: 'at10 genius attack 12k 2026' },
  { nombre: 'Nox AT10 Pro Cup Soft 2026',         phrase: 'at10 pro cup soft 2026' },
  { nombre: 'Nox ML10 Ventus Control 3K 2026',    phrase: 'ml10 ventus control 3k' },
  { nombre: 'Nox ML10 Ventus Control 3K 2026',    phrase: 'ml10 3k 2026' },
  { nombre: 'Nox ML10 Pro Cup Luxury',             phrase: 'ml10 pro cup luxury' },
  { nombre: 'Nox ML10 Pro Cup',                    phrase: 'ml10 pro cup', excludeKeywords: ['beach','tennis','luxury','coorp','3k','black','quantum','shotgun','ventus','bahia','bahía'] },
  { nombre: 'Nox ML10 Quantum',                    phrase: 'ml10 quantum' },
  { nombre: 'Nox ML10 Shotgun',                    phrase: 'ml10 shotgun' },
  { nombre: 'Nox EA10 Ventus Attack 2026',        phrase: 'ea10 ventus attack 2026' },
  { nombre: 'Nox EA10 Ventus Attack 2026',        phrase: 'ea10 attack 2026' },
  { nombre: 'Nox EA10 Ventus Hybrid 12K 2026',    phrase: 'ea10 ventus hybrid 12k' },
  { nombre: 'Nox EA10 Ventus Hybrid 12K 2026',    phrase: 'ea10 hybrid 2026' },
  { nombre: 'Nox Quantum 12K',                    phrase: 'nox quantum 12k' },

  // Black Crown
  { nombre: 'Black Crown Piton 14 2026',          phrase: 'piton 14 2026' },
  { nombre: 'Black Crown Piton White 2026',       phrase: 'piton white 2026' },
  { nombre: 'Black Crown Piton Blue 2026',        phrase: 'piton blue 2026' },
  { nombre: 'Black Crown Hurricane Pro',          phrase: 'hurricane pro' },
  { nombre: 'Black Crown Coyote Yellow',          phrase: 'coyote yellow' },

  // Joma
  { nombre: 'Joma Tournament Pro Iconic',         phrase: 'tournament pro iconic' },
  { nombre: 'Joma Tournament Iconic',             phrase: 'tournament iconic' },
  { nombre: 'Joma Blast Pro',                     phrase: 'joma blast pro',           excludeKeywords: ['hrd','sft','soft'] },
  { nombre: 'Joma Blast Pro HRD',                 phrase: 'joma blast pro hrd' },
  { nombre: 'Joma Blast Pro SFT',                 phrase: 'joma blast pro sft' },
  { nombre: 'Joma Hyper Pro',                     phrase: 'joma hyper pro',           excludeKeywords: ['hrd','soft','sft'] },
  { nombre: 'Joma Hyper Pro HRD',                 phrase: 'joma hyper pro hrd' },
  { nombre: 'Joma Hyper Pro Soft',                phrase: 'joma hyper pro soft' },
  { nombre: 'Joma Hyper Pro Soft',                phrase: 'hyper pro sft' },
  { nombre: 'Joma Hyper 3.0',                     phrase: 'joma hyper 3.0' },
  { nombre: 'Joma Gold Pro 2.0',                  phrase: 'joma gold pro 2.0' },
  { nombre: 'Joma Gold Pro',                      phrase: 'joma gold pro',            excludeKeywords: ['2.0'] },
  { nombre: 'Joma Valkiria Pro HRD',              phrase: 'valkiria pro hrd' },
  { nombre: 'Joma Tournament Soft 2.0',           phrase: 'tournament soft 2.0' },
  { nombre: 'Joma Tournament Flex 2.0',           phrase: 'tournament flex 2.0' },

  // Siux
  { nombre: 'Siux Trilogy 6',                     phrase: 'trilogy 6',                excludeKeywords: ['pro','elite','go'] },
  { nombre: 'Siux Trilogy 6 Elite 2026',          phrase: 'trilogy 6 elite' },
  { nombre: 'Siux Trilogy Elite 2026',            phrase: 'trilogy elite 2026',       excludeKeywords: ['6'] },
  { nombre: 'Siux Trilogy Pro 4',                 phrase: 'trilogy pro 4',            excludeKeywords: ['5'] },
  { nombre: 'Siux Trilogy Pro 5 2025',            phrase: 'trilogy pro 5 2025' },
  { nombre: 'Siux Trilogy Pro 2026',              phrase: 'trilogy pro 2026',         excludeKeywords: ['elite','5'] },
  { nombre: 'Siux Trilogy Go 4',                  phrase: 'trilogy go' },
  { nombre: 'Siux Electra Pro 2026',              phrase: 'electra pro 2026' },
  { nombre: 'Siux Diablo Elite 2026',             phrase: 'diablo elite 2026' },
  { nombre: 'Siux Diablo Pro 4',                  phrase: 'siux diablo pro 4' },
  { nombre: 'Siux Diablo Pro 2026',               phrase: 'diablo pro 2026',          excludeKeywords: ['elite'] },
  { nombre: 'Siux Fenix Pro 2026',                phrase: 'fenix pro 2026' },
  { nombre: 'Siux Fenix Pro 5 2025',              phrase: 'fenix pro 5' },            // títulos sin año explícito
  { nombre: 'Siux Fenix Pro 5 2025',              phrase: 'fenix pro black',           excludeKeywords: ['5','elite'] }, // "fenix pro black 2026/leo augsburger" sin "5"
  { nombre: 'Siux Fenix Elite 2026',              phrase: 'fenix elite 2026' },
  { nombre: 'Siux Astra Hybrid 2026',             phrase: 'astra hybrid 2026' },
  { nombre: 'Siux Tsunami 5.0',                   phrase: 'siux tsunami 5.0' },

  // Wilson
  { nombre: 'Wilson Defy Pro V1 2025',             phrase: 'defy pro v1 2025' },
  { nombre: 'Wilson Defy Pro V1 2026',             phrase: 'defy pro v1 2026' },
  { nombre: 'Wilson Defy V1 Special Edition 2026', phrase: 'defy v1 special edition 2026' },
  { nombre: 'Wilson Defy LS 2026',                 phrase: 'defy ls 2026' },
  { nombre: 'Wilson Defy LS V1',                   phrase: 'defy ls v1' },
  { nombre: 'Wilson Endure Pro V1 2026',           phrase: 'endure pro v1 2026' },
  { nombre: 'Wilson Endure LS 2026',               phrase: 'endure ls 2026' },
  { nombre: 'Wilson Bela LT 2.5',                 phrase: 'bela lt 2.5' },
  { nombre: 'Wilson Bela Team V2',                 phrase: 'bela team v2' },
  { nombre: 'Wilson Bela Pro V3',                  phrase: 'bela pro v3' },
  { nombre: 'Wilson Bela V3',                      phrase: 'bela v3',                  excludeKeywords: ['pro','team','lt'] },

  // Adidas Metalbone puro
  { nombre: 'Adidas Metalbone 3.3', phrase: 'metalbone 3.3',
    excludeKeywords: ['hrd', 'ctrl', 'carbon', 'team', 'light', 'lite'] },
  { nombre: 'Adidas Metalbone 3.4', phrase: 'metalbone 3.4',
    excludeKeywords: ['hrd', 'ctrl', 'carbon', 'team', 'light', 'lite'] },
  { nombre: 'Adidas Metalbone 3.5', phrase: 'metalbone 3.5',
    excludeKeywords: ['hrd', 'ctrl', 'carbon', 'team', 'light', 'lite'] },
  { nombre: 'Adidas Metalbone 09',  phrase: 'metalbone 09' },
  { nombre: 'Adidas Metalbone Pro EDT 2026', phrase: 'metalbone pro edt 2026' },

  // Adidas Metalbone HRD+
  { nombre: 'Adidas Metalbone HRD+ 3.3', phrase: 'metalbone hrd 3.3' },
  { nombre: 'Adidas Metalbone HRD+ 3.3', phrase: 'metalbone 3.3 hrd' },
  { nombre: 'Adidas Metalbone HRD+ 3.4', phrase: 'metalbone hrd 3.4' },
  { nombre: 'Adidas Metalbone HRD+ 3.4', phrase: 'metalbone 3.4 hrd' },
  { nombre: 'Adidas Metalbone HRD+ 3.5', phrase: 'metalbone hrd 3.5' },
  { nombre: 'Adidas Metalbone HRD+ 3.5', phrase: 'metalbone 3.5 hrd' },

  // Adidas Metalbone CTRL
  { nombre: 'Adidas Metalbone CTRL 3.3', phrase: 'metalbone ctrl 3.3', excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Metalbone CTRL 3.3', phrase: 'metalbone 3.3 ctrl', excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Metalbone CTRL 3.4', phrase: 'metalbone ctrl 3.4', excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Metalbone CTRL 3.4', phrase: 'metalbone 3.4 ctrl', excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Metalbone CTRL 3.5', phrase: 'metalbone ctrl 3.5', excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Metalbone CTRL 3.5', phrase: 'metalbone 3.5 ctrl', excludeKeywords: ['carbon'] },

  // Adidas Metalbone Carbon CTRL
  { nombre: 'Adidas Metalbone Carbon CTRL 3.3', phrase: 'metalbone carbon ctrl 3.3' },
  { nombre: 'Adidas Metalbone Carbon CTRL 3.4', phrase: 'metalbone carbon ctrl 3.4' },
  { nombre: 'Adidas Metalbone Carbon CTRL 3.5', phrase: 'metalbone carbon ctrl 3.5' },

  // Adidas Metalbone Team
  { nombre: 'Adidas Metalbone Team 3.3', phrase: 'metalbone team 3.3', excludeKeywords: ['light', 'lite'] },
  { nombre: 'Adidas Metalbone Team 3.4', phrase: 'metalbone team 3.4', excludeKeywords: ['light', 'lite'] },
  { nombre: 'Adidas Metalbone Team 3.5', phrase: 'metalbone team 3.5', excludeKeywords: ['light', 'lite'] },

  // Adidas Metalbone Team Light
  { nombre: 'Adidas Metalbone Team Light 3.3', phrase: 'metalbone team light 3.3' },
  { nombre: 'Adidas Metalbone Team Light 3.4', phrase: 'metalbone team light 3.4' },
  { nombre: 'Adidas Metalbone Team Light 3.5', phrase: 'metalbone team light 3.5' },

  // Adidas Cross It puro
  { nombre: 'Adidas Cross It 3.4', phrase: 'cross it 3.4',
    excludeKeywords: ['ctrl', 'carbon', 'light', 'team'] },
  { nombre: 'Adidas Cross It 3.5', phrase: 'cross it 3.5',
    excludeKeywords: ['ctrl', 'carbon', 'light', 'team'] },

  // Adidas Cross It Light
  { nombre: 'Adidas Cross It Light 3.3', phrase: 'cross it light 3.3', excludeKeywords: ['pro edt','team'] },
  { nombre: 'Adidas Cross It Light 3.4', phrase: 'cross it light 3.4', excludeKeywords: ['pro edt','team'] },
  { nombre: 'Adidas Cross It Light 3.5', phrase: 'cross it light 3.5', excludeKeywords: ['pro edt','team'] },
  { nombre: 'Adidas Cross It Light 2025', phrase: 'cross it light 2025', excludeKeywords: ['pro edt','team'] },
  { nombre: 'Adidas Cross It Light 2026', phrase: 'cross it light 2026', excludeKeywords: ['pro edt','team'] },
  { nombre: 'Adidas Cross It Light Pro EDT 2026', phrase: 'cross it light pro edt 2026' },

  // Adidas Cross It CTRL
  { nombre: 'Adidas Cross It CTRL 3.4',         phrase: 'cross it ctrl 3.4',         excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Cross It CTRL 3.5',         phrase: 'cross it ctrl 3.5',         excludeKeywords: ['carbon'] },

  // Adidas Cross It Carbon / CTRL Carbon / Team CTRL
  { nombre: 'Adidas Cross It Carbon 3.4',       phrase: 'cross it carbon 3.4' },
  { nombre: 'Adidas Cross It Carbon 3.5',       phrase: 'cross it carbon 3.5' },
  { nombre: 'Adidas Cross It CTRL Carbon 2026', phrase: 'cross it ctrl carbon' },
  { nombre: 'Adidas Cross It CTRL Carbon 2026', phrase: 'cross it carbon ctrl' },
  { nombre: 'Adidas Cross It Team CTRL 2026',   phrase: 'cross it team ctrl 2026' },

  // Adidas Arrow Hit
  { nombre: 'Adidas Arrow Hit 3.3', phrase: 'arrow hit 3.3',
    excludeKeywords: ['ctrl', 'carbon'] },
  { nombre: 'Adidas Arrow Hit 3.4', phrase: 'arrow hit 3.4',
    excludeKeywords: ['ctrl', 'carbon'] },
  { nombre: 'Adidas Arrow Hit CTRL 3.3', phrase: 'arrow hit ctrl 3.3',
    excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Arrow Hit CTRL 3.3', phrase: 'arrow hit 3.3 ctrl',
    excludeKeywords: ['carbon'] },
  { nombre: 'Adidas Arrow Hit Carbon 3.3', phrase: 'arrow hit carbon 3.3' },
  { nombre: 'Adidas Arrow Hit Carbon 3.4', phrase: 'arrow hit carbon 3.4' },

  // Adidas Adipower / Reserve
  { nombre: 'Adidas Adipower CTRL',    phrase: 'adidas adipower ctrl' },
  { nombre: 'Adidas Reserve 2026',     phrase: 'adidas reserve 2026' },

  // StarVie
  { nombre: 'StarVie Triton Pro 2024',          phrase: 'triton pro 2024' },
  { nombre: 'StarVie Triton Power 2026',        phrase: 'triton power' },
  { nombre: 'StarVie Triton Balance 2026',      phrase: 'triton balance' },
  { nombre: 'StarVie Basalto Osiris',           phrase: 'basalto osiris' },

  // Vairo
  { nombre: 'Vairo 6.1',                        phrase: 'vairo 6.1' },
  { nombre: 'Vairo 8.1',                        phrase: 'vairo 8.1' },

  // Vibor-A
  { nombre: 'Vibor-A Yarara Radical 12K',       phrase: 'yarara radical 12k' },
  { nombre: 'Vibor-A Yarara Xtreme 3K',         phrase: 'yarara xtreme 3k' },

  // Oxdog
  { nombre: 'Oxdog Ultimate Pro 2026',          phrase: 'oxdog ultimate pro 2026' },
  { nombre: 'Oxdog Hyper Pro 2.0',              phrase: 'oxdog hyper pro 2.0' },

  // Drop Shot
  { nombre: 'Drop Shot Explorer Pro Attack 2.0', phrase: 'explorer pro attack 2.0' },
  { nombre: 'Drop Shot Axion Attack 2.0',        phrase: 'axion attack 2.0' },
  { nombre: 'Drop Shot Blitz Attack 2025',       phrase: 'blitz attack 2025' },

  // Kuikma
  { nombre: 'Kuikma PR Hybrid Carbon',          phrase: 'kuikma pr hybrid carbon' },
  { nombre: 'Kuikma Hybrid Pro',                phrase: 'kuikma hybrid pro' },
  { nombre: 'Kuikma Hybrid Metal',              phrase: 'kuikma hybrid metal' },
  { nombre: 'Kuikma Control Pro',               phrase: 'kuikma control pro' },
  { nombre: 'Kuikma Power Pro',                 phrase: 'kuikma power pro' },
  { nombre: 'Kuikma PR Power Carbon',           phrase: 'kuikma pr power carbon' },
  { nombre: 'Kuikma PR Comfort',                phrase: 'kuikma pr comfort' },
  { nombre: 'Kuikma PR React',                  phrase: 'kuikma pr react' },

  // ── Frases genéricas sin año (vendedores que no ponen año en título) ──────
  // Sin año en nombre porque la phrase no lo fija — no sabemos qué edición vende el anuncio
  // Bullpadel
  { nombre: 'Bullpadel Hack 03',                phrase: 'hack 03' },
  { nombre: 'Bullpadel Iconic',                 phrase: 'bullpadel iconic' },
  { nombre: 'Bullpadel Indiga',                 phrase: 'indiga' },
  { nombre: 'Bullpadel Neuron 02',              phrase: 'neuron 02',             excludeKeywords: ['edge','chingotto'] },
  { nombre: 'Bullpadel Neuron 02 Edge',         phrase: 'neuron 02 edge' },
  { nombre: 'Siux Trilogy Pro 5',               phrase: 'trilogy pro 5',         excludeKeywords: ['2024','2023'] },

  // Babolat
  { nombre: 'Babolat Vertuo',                   phrase: 'vertuo',                excludeKeywords: ['air','technical'] },
  { nombre: 'Babolat Technical Veron',          phrase: 'technical veron' },
  { nombre: 'Babolat Air Veron',                phrase: 'air veron' },

  // Head
  { nombre: 'Head Gravity',                     phrase: 'gravity',               excludeKeywords: ['team','bag','racket'] },
  { nombre: 'Head Extreme One',                 phrase: 'extreme one' },
  { nombre: 'Head Speed One',                   phrase: 'speed one',             excludeKeywords: ['x'] },
  { nombre: 'Head Speed Evo',                   phrase: 'speed evo' },

  // Siux
  { nombre: 'Siux Valkiria',                    phrase: 'siux valkiria' },
  { nombre: 'Siux Electra ST4',                 phrase: 'electra st4' },
  { nombre: 'Siux Trilogy 5',                   phrase: 'trilogy 5',             excludeKeywords: ['pro','elite','go','6'] },
  { nombre: 'Siux Diablo GO 3',                 phrase: 'diablo go 3' },
  { nombre: 'Siux Pegasus 3',                   phrase: 'pegasus 3' },

  // Adidas
  { nombre: 'Adidas Legend',                    phrase: 'adidas legend' },
  { nombre: 'Adidas Metalbone Reserve',         phrase: 'metalbone reserve' },
  { nombre: 'Adidas Adipower Carbon',           phrase: 'adipower carbon' },
  { nombre: 'Adidas Rx Series',                 phrase: 'rx series' },
  { nombre: 'Adidas Bisoke',                    phrase: 'bisoke' },
  { nombre: 'Adidas Drive Black',               phrase: 'drive black' },

  // StarVie
  { nombre: 'StarVie Raptor',                   phrase: 'starvie raptor' },
  { nombre: 'StarVie Titania',                  phrase: 'titania' },
  { nombre: 'StarVie Metheora',                 phrase: 'metheora' },
  { nombre: 'StarVie Basalto',                  phrase: 'basalto',              excludeKeywords: ['osiris'] },
  { nombre: 'StarVie Aquila',                   phrase: 'starvie aquila' },
  { nombre: 'StarVie Astrum',                   phrase: 'astrum' },
  { nombre: 'StarVie Dronos',                   phrase: 'dronos' },

  // Black Crown
  { nombre: 'Black Crown Gladius',              phrase: 'gladius',              excludeKeywords: ['drop shot','drop-shot'] },

  // Wilson
  { nombre: 'Wilson Endure V1',                 phrase: 'endure v1',             excludeKeywords: ['pro','ls'] },
  { nombre: 'Wilson Bela LS V3',                phrase: 'bela ls v3' },

  // Nox
  { nombre: 'Nox AT10 Pro Cup',                 phrase: 'at10 pro cup',          excludeKeywords: ['soft'] },
  { nombre: 'Nox Equation',                     phrase: 'nox equation' },
  { nombre: 'Nox AT10 Luxury Genius 12K',       phrase: 'at10 luxury genius 12k' },

  // Dunlop
  { nombre: 'Dunlop Galactica',                 phrase: 'galactica' },

  // Lok
  { nombre: 'Lok Maxx Hype',                    phrase: 'maxx hype' },
  { nombre: 'Lok Be Flow',                      phrase: 'be flow' },
  { nombre: 'Lok Carbon Hype',                  phrase: 'carbon hype' },
  { nombre: 'Lok Jungle',                       phrase: 'lok jungle' },
  { nombre: 'Lok Easy Flow',                    phrase: 'easy flow' },

  // Drop Shot
  { nombre: 'Drop Shot Explorer Pro',           phrase: 'explorer pro',          excludeKeywords: ['attack'] },
  { nombre: 'Drop Shot Canyon Pro',             phrase: 'canyon pro' },

  // Enebe
  { nombre: 'Enebe Spitfire',                   phrase: 'spitfire' },
]

function calcMediana(precios: number[]): number | null {
  if (precios.length < MIN_ITEMS_FOR_MEDIANA) return null
  const sorted = [...precios].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function isWallapopActive(externalId: string, phrase?: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.wallapop.com/api/v3/items/${externalId}`, {
      headers: {
        'Accept':          'application/json',
        'MPlatform':       'WEB',
        'Accept-Language': 'es-ES',
      },
    })

    if (res.status === 404 || res.status === 410) return false

    if (res.ok) {
      const data = await res.json()
      if (data?.reserved?.flag === true) return false
      if (data?.sold?.flag === true) return false
      if (data?.item?.flags?.sold || data?.item?.flags?.reserved) return false

      if (phrase) {
        const currentTitle = (
          data?.item?.title ??
          data?.content?.title ??
          data?.title ??
          ''
        ).toLowerCase()
        if (currentTitle.length > 0 && !currentTitle.includes(phrase.toLowerCase())) {
          console.log(`  Titulo cambio - ya no contiene "${phrase}" - descartado y limpiado`)
          return false
        }
      }

      return true
    }

    console.warn(`  API Wallapop devolvio ${res.status} para ${externalId} - asumimos activo`)
    return true
  } catch {
    return true
  }
}

async function buscarModelo(supabase: any, modelo: Modelo): Promise<any[]> {
  console.log(`\nBuscando "${modelo.nombre}" - frase: "${modelo.phrase}"`)

  // Solo anuncios vistos por el scraper en los últimos 7 días → precio fresco.
  // Si el vendedor cambia el precio y el anuncio cae del ranking de búsqueda,
  // el scraper deja de verlo y last_seen_at queda desactualizado; excluirlo
  // evita mostrar precios congelados que ya no reflejan la realidad.
  const hace7Dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('wallapop_cache')
    .select('external_id, title, price, condition, platform, img, url, city, pala_id, scraped_at, date')
    .in('condition', CONDICIONES_TOP)
    .gte('price', MIN_PRICE)
    .gte('last_seen_at', hace7Dias)
    .ilike('title', `%${modelo.phrase}%`)
    .limit(500)

  if (error) {
    console.error(`  Error:`, error)
    return []
  }

  if (!data || data.length === 0) {
    console.log(`  Sin resultados`)
    return []
  }

  const antes = data.length
  const items: any[] = (data as any[]).filter(item => {
    if (EXCLUIR_SIEMPRE_RE.some(re => re.test(item.title))) return false
    // Descartar si el título menciona explícitamente un año ≤ 2023
    const mAño = item.title.match(/\b(20\d{2})\b/)
    if (mAño && parseInt(mAño[1], 10) < 2024) return false
    if (modelo.excludeKeywords) {
      const t = item.title.toLowerCase()
      if (modelo.excludeKeywords.some(excl => t.includes(excl.toLowerCase()))) return false
    }
    return true
  })

  if (items.length < antes) {
    console.log(`  ${antes - items.length} descartados (jr/reparar/variante/tenis)`)
  }
  console.log(`  ${items.length} anuncios validos`)

  const precios = items.map(item => item.price as number)
  const mediana = calcMediana(precios)

  if (mediana === null) {
    console.log(`  Solo ${items.length} items (min ${MIN_ITEMS_FOR_MEDIANA}) - sin mediana`)
    return []
  }

  console.log(`  Mediana: ${Math.round(mediana)}EUR (${items.length} anuncios)`)

  const umbral = mediana * THRESHOLD_OPORTUNIDAD
  const oportunidades: any[] = []

  for (const item of items) {
    if (item.price >= umbral) continue
    const descuento_pct  = Math.round(((mediana - item.price) / mediana) * 100)
    const ahorro_euros   = mediana - item.price
    const score = Math.round(
      descuento_pct
      + ahorro_euros   * PESO_AHORRO_EUROS
      + calcularBonusAño(modelo.nombre)
      + (item.condition === 'new' ? BONUS_NEW : 0)
      + calcularPenAntiguedad(item.date ?? null)
    )
    oportunidades.push({
      external_id:  item.external_id,
      title:        item.title,
      price:        item.price,
      precio_medio: Math.round(mediana * 100) / 100,
      descuento_pct,
      score,
      condition:    item.condition,
      platform:     item.platform,
      img:          item.img ?? null,
      url:          item.url,
      city:         item.city ?? null,
      keyword:      modelo.nombre,
      phrase:       modelo.phrase,
      pala_id:      item.pala_id ?? null,
    })
  }

  console.log(`  ${oportunidades.length} oportunidades (< ${Math.round(umbral)}EUR)`)
  return oportunidades
}

async function main() {
  console.log('HUNTPADEL - Top Oportunidades (v3: frase exacta + regex exclusiones)')
  console.log(`Fecha: ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  console.log('Leyendo posiciones actuales...')
  const { data: topActual } = await supabase
    .from('top_oportunidades')
    .select('external_id, posicion')
    .order('posicion', { ascending: true })

  const posicionesAnteriores = new Map<string, number>()
  if (topActual) {
    for (const row of topActual as any[]) {
      if (row.external_id && row.posicion) {
        posicionesAnteriores.set(row.external_id, row.posicion)
      }
    }
  }
  console.log(`  ${posicionesAnteriores.size} entradas en el top actual`)

  console.log(`\nProcesando ${MODELOS.length} modelos curados...`)

  const todasOportunidades: any[] = []
  for (const modelo of MODELOS) {
    const ops = await buscarModelo(supabase, modelo)
    todasOportunidades.push(...ops)
  }

  console.log(`\n${todasOportunidades.length} oportunidades totales`)

  if (todasOportunidades.length === 0) {
    console.log('Sin oportunidades - no se actualiza la tabla.')
    return
  }

  const deduplicado = new Map<string, any>()
  for (const op of todasOportunidades) {
    const existing = deduplicado.get(op.external_id)
    if (!existing || op.score > existing.score) {
      deduplicado.set(op.external_id, op)
    }
  }

  const candidatos = Array.from(deduplicado.values())
    .sort((a, b) => b.score - a.score)

  console.log(`${candidatos.length} candidatos unicos`)

  const maxVerificar = Math.min(candidatos.length, TOP_N * 3)
  console.log(`\nVerificando hasta ${maxVerificar} candidatos...\n`)

  const top: any[] = []
  const vendidosABorrar: string[] = []

  for (let i = 0; i < maxVerificar && top.length < TOP_N; i++) {
    const candidato = candidatos[i]

    if (candidato.platform !== 'wallapop') {
      top.push(candidato)
      continue
    }

    process.stdout.write(
      `  [${i + 1}/${maxVerificar}] ${candidato.external_id}` +
      ` (-${candidato.descuento_pct}% vs ${Math.round(candidato.precio_medio)}EUR, [${candidato.keyword}])... `
    )
    const activo = await isWallapopActive(candidato.external_id, candidato.phrase)

    if (activo) {
      console.log('activo')
      top.push(candidato)
    } else {
      console.log('vendido - descartado')
      vendidosABorrar.push(candidato.external_id)
    }

    await sleep(VERIFY_THROTTLE)
  }

  const ahora = new Date().toISOString()
  console.log(`\nTop ${top.length} final:`)

  const topConTendencia = top.map((op, idx) => {
    const posicionNueva    = idx + 1
    const posicionAnterior = posicionesAnteriores.get(op.external_id) ?? null

    let tendencia: 'nueva_entrada' | 'sube' | 'baja' | 'igual'
    if (posicionAnterior === null)             tendencia = 'nueva_entrada'
    else if (posicionNueva < posicionAnterior) tendencia = 'sube'
    else if (posicionNueva > posicionAnterior) tendencia = 'baja'
    else                                       tendencia = 'igual'

    const puestosMovidos = posicionAnterior !== null ? posicionAnterior - posicionNueva : null

    console.log(`  ${posicionNueva}. ${op.title} - ${op.price}EUR (mediana: ${Math.round(op.precio_medio)}EUR, -${op.descuento_pct}%, [${op.keyword}])`)

    return { ...op, posicion: posicionNueva, posicion_anterior: posicionAnterior, puestos_movidos: puestosMovidos, tendencia, updated_at: ahora }
  })

  if (vendidosABorrar.length > 0) {
    console.log(`\nEliminando ${vendidosABorrar.length} anuncios vendidos de wallapop_cache.`)
    const { error: delErr } = await supabase.from('wallapop_cache').delete().in('external_id', vendidosABorrar)
    if (delErr) console.error('  Error al borrar:', delErr)
    else        console.log('  Limpieza OK')
  }

  if (topConTendencia.length === 0) {
    console.log('\nTop vacio - no se actualiza la tabla.')
    return
  }

  console.log(`\nGuardando top ${topConTendencia.length}...`)

  const { error: deleteErr } = await supabase
    .from('top_oportunidades')
    .delete()
    .gte('posicion', 1)

  if (deleteErr) console.error('  Error borrando entradas antiguas:', deleteErr)

  const { error: insertErr } = await supabase
    .from('top_oportunidades')
    .insert(topConTendencia)

  if (insertErr) {
    console.error('Error guardando:', insertErr)
    process.exit(1)
  }
  console.log(`Top ${topConTendencia.length} guardado correctamente.`)
}

main().catch(err => {
  console.error('Error fatal:', err)
  process.exit(1)
})
