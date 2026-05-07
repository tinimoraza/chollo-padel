const WALLAPOP_SEARCH_URL = 'https://api.wallapop.com/api/v3/general/search';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Origin': 'https://es.wallapop.com',
  'Referer': 'https://es.wallapop.com/',
  'DeviceOS': '0',
  'X-AppVersion': '75800',
};

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
}

// Alias para compatibilidad con cron y otros archivos
export type PalaItem = WallapopItem;

function parseItems(rawItems: any[]): WallapopItem[] {
  return rawItems.map((item: any) => ({
    id: item.id ?? '',
    title: item.title ?? '',
    description: item.description ?? '',
    price: item.price?.amount ?? item.sale_price ?? 0,
    currency: item.price?.currency ?? 'EUR',
    images: item.images?.map((img: any) => img.urls?.medium ?? img.original ?? '') ?? [],
    url: `https://es.wallapop.com/item/${item.web_slug ?? item.id}`,
    condition: item.condition ?? '',
    location: item.location?.city ?? item.location?.country_code ?? '',
  }));
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

  try {
    const res = await fetch(`${WALLAPOP_SEARCH_URL}?${params.toString()}`, {
      headers: HEADERS,
      cache: 'no-store',
    });

    if (!res.ok) {
      console.error(`Wallapop respondió con status ${res.status}`);
      return [];
    }

    const data = await res.json();

    const rawItems =
      data?.search_objects ??
      data?.data?.search_objects ??
      data?.items ??
      [];

    return parseItems(rawItems);
  } catch (err) {
    console.error('Error llamando a Wallapop:', err);
    return [];
  }
}
