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
      searchString: query,
      maxItems: 10,
    };

    if (maxPrice) input.maxPrice = maxPrice;
    if (minPrice) input.minPrice = minPrice;

    const res = await fetch(
      `https://api.apify.com/v2/acts/seretalabs~wallapop-scraper/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=120`,
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
    console.log(`Apify devolvió ${data.length} items para "${query}"`);

    return data.map((item: any) => {
      const cityName = item.location?.city ?? item.city?.city ?? '';
      const imageUrl = item.images?.[0]?.urls?.medium ?? item.images?.[0]?.urls?.small ?? '';
      const allImages = (item.images ?? []).map((img: any) => img.urls?.medium ?? img.urls?.small ?? '');
      const itemUrl = `https://es.wallapop.com/item/${item.id}`;
      const price = item.price?.amount ?? item.price ?? 0;

      return {
        id: item.id ?? '',
        title: item.title ?? '',
        description: item.description ?? '',
        price,
        currency: item.price?.currency ?? 'EUR',
        images: allImages,
        url: itemUrl,
        condition: item.condition ?? '',
        location: cityName,
        city: cityName,
      };
    });
  } catch (err) {
    console.error('Error en searchWallapop:', err);
    return [];
  }
}
