/**
 * RUTA DE TEST TEMPORAL — eliminar después de probar
 * Ruta: app/api/test-wallapop/route.ts
 *
 * Visita: https://chollo-padel.vercel.app/api/test-wallapop
 * para ver si Wallapop responde desde los servidores de Vercel.
 */

import { createHmac } from "crypto";
import { NextResponse } from "next/server";

function getSignature(path: string, timestamp: string) {
  const SECRET  = "Tm93IHRoYXQgeW91J3ZlIGZvdW5kIHRoaXMsIGFyZSB5b3UgcmVhZHkgdG8gam9pbiB1cz8gam9ic0B3YWxsYXBvcC5jb20==";
  const payload = ["GET", path, timestamp].join("|") + "|";
  return createHmac("sha256", SECRET).update(payload).digest("base64");
}

export async function GET() {
  const params = new URLSearchParams({
    keywords:  "pala padel",
    latitude:  "40.4168",
    longitude: "-3.7038",
    order_by:  "newest",
    start:     "0",
    step:      "3",
  });

  const path      = `/api/v3/general/search?${params}`;
  const timestamp = String(Date.now());

  try {
    const res = await fetch(`https://api.wallapop.com${path}`, {
      headers: {
        "Accept":             "application/json",
        "Accept-Language":    "es-ES,es;q=0.9",
        "User-Agent":         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "X-Signature":        getSignature(path, timestamp),
        "Timestamp":          timestamp,
        "DeviceOS":           "0",
        "MPlatform":          "WEB",
        "Origin":             "https://es.wallapop.com",
        "Referer":            "https://es.wallapop.com/",
        "sec-ch-ua":          '"Chromium";v="124", "Google Chrome";v="124"',
        "sec-ch-ua-mobile":   "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest":     "empty",
        "sec-fetch-mode":     "cors",
        "sec-fetch-site":     "same-site",
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, status: res.status, error: "Wallapop bloqueó la petición" },
        { status: 200 } // devolvemos 200 para que puedas leer el JSON igualmente
      );
    }

    const data  = await res.json();
    const items = data?.search_objects ?? data?.items ?? [];

    // Devolvemos los primeros 3 items simplificados
    const preview = items.slice(0, 3).map((item: any) => ({
      id:        item.id,
      título:    item.title,
      precio:    item.sale_price ?? item.price,
      condición: item.condition,
      url:       `https://es.wallapop.com/item/${item.web_slug}`,
      imagen:    item.main_image_url,
    }));

    return NextResponse.json({ ok: true, total: items.length, preview });

  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 200 });
  }
}
