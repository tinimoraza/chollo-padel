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

export async function searchWallapop(query: string, maxPrice?: number, minPrice?: number): Promise<WallapopItem[]> {
  try {
    const input = {
      search: query,
      maxItems: 40,
      ...(maxPrice && { maxPrice }),
      ...(minPrice && { minPrice }),
    };

    const res = await fetch(
      `https://api.apify.com/v2/acts/louisdeconinck~wallapop-scraper/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=30`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      console.error(`Apify error: ${res.status}`);
      return [];
    }

    const data = await res.json();
    console.log(`Apify devolvió ${data.length} items para "${query}"`);

    return data.map((item: any) => ({
      id: item.id ?? '',
      title: item.title ?? '',
      description: item.description ?? '',
      price: item.price ?? 0,
      currency: 'EUR',
      images: item.images ?? [],
      url: item.url ?? '',
      condition: item.condition ?? '',
      location: item.location ?? '',
      city: item.location ?? '',
    }));
  } catch (err) {
    console.error('Error en searchWallapop:', err);
    return [];
  }
}
