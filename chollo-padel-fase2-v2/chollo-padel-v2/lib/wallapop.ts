const WALLAPOP_SEARCH_URL = 'https://api.wallapop.com/api/v3/general/search';

export interface WallapopItem {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  images: string[];
  url: string;
  condition: string;
  location: string;
  city: string;
}

export type PalaItem = WallapopItem;

function parseItems(rawItems: any[]): WallapopItem[] {
  return rawItems.map((item: any) => {
    const city = item.location?.city ?? item.location?.country_code ?? '';
    return {
      id: item.id ?? '',
      title: item.title ?? '',
      description: item.description ?? '',
      price: item.price?.amount ?? item.sale_price ?? 0,
      currency: item.price?.currency ?? 'EUR',
      images: item.images?.map((img: any) => img.urls?.medium ?? img.original ?? '') ?? [],
      url: `https://es.wallapop.com/item/${item.web_slug ?? item.id}`,
      condition: item.condition ?? '',
      location: city,
      city: city,
    };
  });
}

export async function searchWallapop(query: string, maxPrice?: number, minPrice?: number): Promise<WallapopItem[]> {
  const params = new URLSearchParams({
    keywords: query,
    filters_source: 'quick_filters',
    order_by: 'newest',
    start: '0',
    items_count: '40',
    latitude: '40.4168',
    longitude: '-3.7038',
    country_code: 'ES',
    language: 'es_ES',
  });

  if (maxPrice) params.set('max_sale_price', String(maxPrice));
  if (minPrice) params.set('min_sale_price', String(minPrice));

  const wallapopUrl = `${WALLAPOP_SEARCH_URL}?${params.toString()}`;

  const scrapingBeeUrl = `https://app.scrapingbee.com/api/v1/?api_key=${process.env.SCRAPINGBEE_API_KEY}&url=${encodeURIComponent(wallapopUrl)}&render_js=false&custom_google=false&return_page_source=false`;

  try {
    const res = await fetch(scrapingBeeUrl, {
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`ScrapingBee error ${res.status}:`, errText);
      return [];
    }

    // ScrapingBee devuelve el body de la respuesta original como texto
    const text = await res.text();

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      console.error('No se pudo parsear la respuesta de ScrapingBee:', text.slice(0, 300));
      return [];
    }

    const rawItems =
      data?.search_objects ??
      data?.data?.search_objects ??
      data?.items ??
      [];

    console.log(`Wallapop devolvió ${rawItems.length} items para "${query}"`);
    return parseItems(rawItems);
  } catch (err) {
    console.error('Error en searchWallapop:', err);
    return [];
  }
}
