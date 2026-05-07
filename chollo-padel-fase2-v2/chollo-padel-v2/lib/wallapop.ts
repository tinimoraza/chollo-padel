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
    const input: any = {
      keyword: query,
      maxItems: 10,
    };

    if (maxPrice) input.maxPrice = maxPrice;
    if (minPrice) input.minPrice = minPrice;

    const res = await fetch(
      `https://api.apify.com/v2/acts/data_alchemist~wallapop-search/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=120`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Apify error ${res.status}:`, errText);
      return [];
    }

    const data = await res.json();
    console.log('Raw:', JSON.stringify(data.slice(0, 1)));
    console.log(`Apify devolvió ${data.length} items para "${query}"`);

    return data.map((item: any) => ({
      id: item.id ?? '',
      title: item.title ?? '',
      description: item.description ?? '',
      price: item.price ?? item.sale_price ?? 0,
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
