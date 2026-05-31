# 🏓 HUNTPADEL — Master List Tiendas para Scraping de Precios

> Última actualización: 2026-05-22  
> Criterio de prioridad: volumen de palas en catálogo × tráfico × probabilidad de tener API/feed fácil

---

## TIER 0 — Ya en producción ✅

| Tienda | URL | Método actual |
|--------|-----|---------------|
| Padel Nuestro | padelnuestro.com | scraper propio (JS) |
| Padelzoom | padelzoom.com | FacetWP POST API |

---

## TIER 1 — Siguiente sprint (alto volumen, alta prioridad)

Tiendas con catálogo amplio de palas, tráfico alto en España y alta probabilidad de tener endpoint aprovechable.

| # | Tienda | URL | Plataforma probable | Notas |
|---|--------|-----|---------------------|-------|
| 1 | Zona de Padel | zonadepadel.es | **PrestaShop** (confirmado) | líder España, +3000 refs, PrestaShop premiado 2016 — igual patrón que Padelzoom |
| 2 | Padel Ibérico | padeliberico.es | PrestaShop probable | 10K reseñas Trustpilot, "precios más bajos del mercado", stock real |
| 3 | Padel Market | padelmarket.com | WooCommerce probable | tienda de Paquito Navarro, 5K reseñas, muy competitivo en precio. URL confirmada: padelmarket.com |
| 4 | TiendaPadelPoint | tiendapadelpoint.com | PrestaShop probable | físico + online, internacional, muy competitivo. URL confirmada: tiendapadelpoint.com |
| 5 | PadelPROShop | padelproshop.com | **Shopify** (URL /collections/ confirma Shopify) | 6K reseñas, descuentos agresivos (hasta -48%), exclusivas propias |
| 6 | Time2Padel | time2padel.com | PrestaShop probable | gran catálogo, fuerte en Europa |
| 7 | Ofertas de Pádel | ofertasdepadel.com | PrestaShop probable | 575 reseñas, especializado en outlet y ofertas — clave para chollos |
| 8 | Padel-Spain | padel-spain.es | PrestaShop probable | precio competitivo |

---

## TIER 2 — Tiendas oficiales de marca (PVP de referencia)

Importante para tener el **precio oficial** como techo de descuento, no para seguimiento diario.

| # | Tienda | URL | Notas |
|---|--------|-----|-------|
| 1 | Bullpadel Oficial | bullpadel.com | PVP oficial Bullpadel. Venden directamente online |
| 2 | NOX Oficial | nox.es | PVP oficial NOX |
| 3 | Decathlon | decathlon.es/es/deportes/padel | Kuikma exclusivo aquí. API Decathlon accesible |
| 4 | AllForPadel (Adidas) | allforpadel.com | Tienda oficial Adidas pádel en España |
| 5 | Head Oficial | head.com/es-ES | PVP Head |
| 6 | Babolat Oficial | babolat.com/es | PVP Babolat |
| 7 | Adidas Oficial | adidas.es | PVP Adidas (metalbone, etc) |
| 8 | StarVie Oficial | starvie.com | PVP StarVie |
| 9 | Siux Oficial | siux.es | PVP Siux |
| 10 | Vibor-A Oficial | vibor-a.com | PVP Vibor-A |

---

## TIER 3 — Tiendas secundarias (buena cobertura, útiles para triangular precio)

| # | Tienda | URL | Notas |
|---|--------|-----|-------|
| 1 | Street Padel | streetpadel.com | buena cobertura multimarca. URL confirmada: streetpadel.com |
| 0 | Padel Vice | padelvice.com | pendiente inspección | URL confirmada: padelvice.com |
| 2 | Mister Padel | misterpadel.com | Italia + España, buen precio |
| 3 | PadelShop | padelshop.com | 3K reseñas, 4.8★ Trustpilot |
| 4 | PadelKiwi | padelkiwi.com | 2K reseñas, 4.6★ |
| 5 | PDH Sports | pdhsports.com | 1K reseñas |
| 6 | Padel Star (tienda) | padelstar.es/tienda | revista + tienda |
| 7 | TiendaPadel5 | tiendapadel5.com | también vende con defectos estéticos (interesante para chollos) |
| 8 | Smashinn | tradeinn.com/smashinn | TradeInn group, precio agresivo internacional |
| 9 | Bandeja Shop | bandeja-shop.com | multimarca |
| 10 | Boom Padel | boom-padel.com | |
| 11 | Padel Nuestro (outlet) | padelnuestro.com/outlet | ya scrapeamos el principal |
| 12 | CarbóSport | carbosports.com | especializado carbono / alto gama |
| 13 | FlickPadel | flickpadel.com | |
| 14 | AreaPadel | areapadel.com | |
| 15 | **Roma Sport** | romasport.es | **WooCommerce** (URLs /categoria-producto/ confirman WC). Valencia. Distribuidor autorizado, precios agresivos (-31% a -38% en Adidas). Tiene palas de TEST a precio reducido — muy interesante para chollos |
| 16 | **Padel Coronado** | padelcoronado.com | **WooCommerce** probable. Tienda física + online. ~1147 productos. Cubre marcas buenas: Adidas, Babolat, Bullpadel, NOX, Siux, Wilson, Vibora, StarVie, Tecnifibre, J'Hayber, Enebe |

---

## TIER 4 — Grandes superficies (solo marcas masivas)

| # | Tienda | URL | Notas |
|---|--------|-----|-------|
| 1 | Decathlon | decathlon.es | ya en Tier 2, API pública |
| 2 | El Corte Inglés | elcorteingles.es/deportes/padel | pocas marcas pero precio oficial |
| 3 | Amazon España | amazon.es | trampa: precios de marketplace, no fiables como referencia |
| 4 | Forum Sport | forumsport.com | multideporte, pocas palas |

---

## TIER ESPECIAL — Marketplaces (tratamiento diferente)

⚠️ Los marketplaces NO son fuente de `price_reference` — los precios son de múltiples vendedores (tiendas, revendedores, particulares) y pueden estar inflados o ser irreales. **Uso recomendado: detección de chollos de tiendas que venden ahí con descuento**, no como referencia de PVP.

| # | Plataforma | URL | Notas |
|---|-----------|-----|-------|
| 1 | **Miravia** | miravia.es/c/padel-15191 | Marketplace español (Alibaba group). Venden ahí Zona de Padel, Padel Nuestro, PadelPROShop y otras tiendas con descuentos exclusivos. Tiene API paginada. **Útil**: tiendas conocidas publican ahí chollos que no aparecen en su web propia |
| 2 | **Amazon España** | amazon.es | Marketplace global. Venden muchas tiendas de la lista. Precio muy variable (Buy Box cambia). **Útil solo** para marcas que venden directamente (Bullpadel, NOX, Adidas) como verificación de PVP oficial |
| 3 | ~~eBay España~~ | ebay.es | Excluir — mix de segunda mano y tiendas, imposible distinguir. Ya cubrimos segunda mano con Wallapop/Vinted |

### Cómo tratar Miravia
Miravia sí merece scraping propio porque **las tiendas de padel publican ofertas flash exclusivas** allí que no aparecen en su propia web. La estrategia:
- Scraper Miravia → detectar palas de marca conocida con precio < price_reference × 0.85
- Mostrar como "Chollo en Miravia (vendido por X tienda)" con enlace directo
- NO usar el precio de Miravia para calcular price_reference

### Cómo tratar Amazon
- Solo consultar Amazon para verificar PVP de marcas que venden directamente (Bullpadel, NOX, Adidas)
- Ignorar vendedores terceros (fulfilled by Amazon de revendedores)
- No scraping masivo — riesgo alto de bloqueo

---

## TIER 5 — Europa (para detectar chollos cross-border)

Útil si en el futuro quieres mostrar que una pala está a X€ en Francia y a Y€ en España.

| # | Tienda | URL | País |
|---|--------|-----|------|
| 1 | Esprit Padel Shop | esprit-padel-shop.com | Francia |
| 2 | French Padel Shop | frenchpadelshop.com | Francia |
| 3 | MisterPadel (.it) | misterpadel.com/it | Italia |
| 4 | Europe Padel Shop | europepadelshop.com | Europa |
| 5 | Padel Kiwi | padelkiwi.com | UK/Europa |

---

## Plan de ejecución recomendado

### Semana 1 — Tier 1 parte A (3 tiendas)
Empezar por las que probablemente sean Shopify o tengan FacetWP (igual que Padelzoom):

1. **PadelPROShop** — Shopify confirmado (`/collections/` en URL). Scraper en 1h: `GET /collections/palas-padel/products.json?limit=250`
2. **Zona de Padel** — PrestaShop. Inspeccionar filtro de palas en DevTools → probablemente FacetWP o endpoint propio
3. **Ofertas de Pádel** — outlet especializado, clave para chollos

### Semana 1 — Tier 1 parte B (3 tiendas)
4. **Padel Ibérico** — inspeccionar plataforma
5. **Time2Padel** — inspeccionar plataforma  
6. **Padel Market** — inspeccionar plataforma

### Semana 2 — Tier 2 marcas oficiales (PVP)
Bullpadel, NOX, Decathlon (Kuikma), AllForPadel.  
Objetivo: rellenar `palas.precio_pvp` donde esté vacío.

### Semana 2-3 — Tier 3 (completar cobertura)
Añadir según impacto en price_reference. Prioridad: Street Padel, PadelShop, Smashinn.

---

## Método de inspección antes de escribir cada scraper

Abrir DevTools en la sección de palas de cada tienda y buscar:

```
# Shopify
GET /collections/palas-padel/products.json?limit=250&page=1
→ si responde JSON con "products": [...] → scrapers en 30min

# PrestaShop FacetWP (igual que Padelzoom)
POST /index.php?fc=module&module=pm_advancedsearch&controller=SearchProductsAjax
→ o buscar POST a cualquier URL con "facet" o "search" en el nombre

# PrestaShop API nativa
GET /api/products?output_format=JSON&display=full
→ requiere clave API del admin — no disponible públicamente

# WooCommerce
GET /wp-json/wc/v3/products?category=palas&per_page=100
→ a veces abierto sin auth, a veces requiere Consumer Key

# Decathlon (API pública)
GET https://www.decathlon.es/es/search?Nrpp=96&No=0&Ntt=pala+padel&jsonoutput=true
→ o API de producto por código de artículo
```

---

## Notas importantes

- **Amazon**: excluir siempre. Los precios son de marketplace, pueden ser de revendedores a precio inflado o deflado, no representan el PVP real.
- **TiendaPadel5**: interesante porque vende palas **con defectos estéticos** a precio reducido — no usar para price_reference, pero sí para detectar modelos con outlet.
- **Smashinn (TradeInn)**: precio muy agresivo por ser internacional (sin IVA a veces). Puede contaminar price_reference a la baja — usar con peso menor o como precio_minimo_tiendas.
- **Marcas oficiales**: el precio en bullpadel.com / nox.es suele ser el PVP más alto — perfecto como techo para calcular descuentos reales.
