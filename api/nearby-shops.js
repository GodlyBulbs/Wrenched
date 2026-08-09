// /api/nearby-shops.js
//
// Vercel serverless function powering the "Find a Shop" tab.
// Takes the user's location plus two resolved search terms (computed client-side
// from BRAND_DEALER_SEARCH and SPECIALTY_SEARCH in App.jsx) and returns three
// categories: the brand's factory dealer (null/skipped for discontinued brands
// with no current dealer network), real independent shops that specialize in
// that marque/region (e.g. "Japanese import specialist" for a Honda), and
// brand-agnostic quick-service chains (Valvoline, Jiffy Lube, etc.).
//
// SETUP REQUIRED:
// 1. Enable the "Places API" (legacy) in Google Cloud Console for your project.
// 2. Create an API key, restrict it to the Places API and to your server's
//    IP/referrer as appropriate for a server-side key (do NOT use a
//    browser-restricted key here — this key is used server-side only).
// 3. Add it as an environment variable in Vercel: GOOGLE_PLACES_API_KEY
//
// This uses the Text Search endpoint (maps.googleapis.com/maps/api/place/textsearch/json)
// biased toward the user's location. Google's newer Places API (v1) is also an option
// if you'd prefer to migrate later — the response shape here is normalized either way
// so the frontend doesn't need to change if you swap the implementation.

const RADIUS_METERS = 24140; // ~15 miles
const MAX_RESULTS_PER_CATEGORY = 6;

function milesBetween(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function textSearch(query, lat, lng, apiKey) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query);
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", String(RADIUS_METERS));
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    console.error("Places API error:", data.status, data.error_message);
    return [];
  }
  return (data.results || []).map((r) => ({
    name: r.name,
    address: r.formatted_address,
    lat: r.geometry?.location?.lat,
    lng: r.geometry?.location?.lng,
    placeId: r.place_id,
    rating: r.rating,
    distanceMi:
      r.geometry?.location?.lat != null
        ? milesBetween(lat, lng, r.geometry.location.lat, r.geometry.location.lng)
        : null,
  }));
}

// Text Search doesn't return phone numbers — a lightweight Place Details
// call fills that in for each result. Kept optional/best-effort so a
// details failure never blocks the whole list from rendering.
async function fetchPhone(placeId, apiKey) {
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", placeId);
    url.searchParams.set("fields", "formatted_phone_number");
    url.searchParams.set("key", apiKey);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    return data.result?.formatted_phone_number || null;
  } catch {
    return null;
  }
}

async function enrichWithPhones(shops, apiKey) {
  const enriched = await Promise.all(
    shops.map(async (shop) => ({
      ...shop,
      phone: shop.placeId ? await fetchPhone(shop.placeId, apiKey) : null,
    }))
  );
  return enriched;
}

function dedupeByPlaceId(shops) {
  const seen = new Set();
  return shops.filter((s) => {
    if (!s.placeId || seen.has(s.placeId)) return false;
    seen.add(s.placeId);
    return true;
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Shop search isn't configured yet — missing GOOGLE_PLACES_API_KEY." });
  }

  const { lat, lng, dealerSearchTerm, specialtySearchTerm, quickServiceSearchTerms } = req.body || {};
  // dealerSearchTerm is intentionally optional/null here — discontinued brands (Pontiac, Saab,
  // etc.) have no real dealer network, so the frontend sends null rather than a search that
  // would return misleading results.
  if (typeof lat !== "number" || typeof lng !== "number" || !specialtySearchTerm) {
    return res.status(400).json({ error: "Missing lat, lng, or specialtySearchTerm." });
  }

  try {
    const [dealerResults, specialtyResults] = await Promise.all([
      dealerSearchTerm ? textSearch(dealerSearchTerm, lat, lng, apiKey) : Promise.resolve([]),
      textSearch(specialtySearchTerm, lat, lng, apiKey),
    ]);

    const terms = Array.isArray(quickServiceSearchTerms) && quickServiceSearchTerms.length
      ? quickServiceSearchTerms
      : ["oil change", "tire shop"];
    const quickServiceBatches = await Promise.all(
      terms.map((term) => textSearch(term, lat, lng, apiKey))
    );
    const quickServiceResults = dedupeByPlaceId(quickServiceBatches.flat());

    const dealersSorted = dealerResults
      .sort((a, b) => (a.distanceMi ?? 999) - (b.distanceMi ?? 999))
      .slice(0, MAX_RESULTS_PER_CATEGORY);
    // Specialty shops overlap in name with dealer results sometimes (e.g. a used-car lot that
    // also shows up under a general search) — de-dupe against the dealer list so the same
    // place doesn't appear in both sections.
    const dealerPlaceIds = new Set(dealersSorted.map((s) => s.placeId));
    const specialtySorted = specialtyResults
      .filter((s) => !dealerPlaceIds.has(s.placeId))
      .sort((a, b) => (a.distanceMi ?? 999) - (b.distanceMi ?? 999))
      .slice(0, MAX_RESULTS_PER_CATEGORY);
    const quickServiceSorted = quickServiceResults
      .sort((a, b) => (a.distanceMi ?? 999) - (b.distanceMi ?? 999))
      .slice(0, MAX_RESULTS_PER_CATEGORY);

    const [dealersWithPhones, specialtyWithPhones, quickServiceWithPhones] = await Promise.all([
      enrichWithPhones(dealersSorted, apiKey),
      enrichWithPhones(specialtySorted, apiKey),
      enrichWithPhones(quickServiceSorted, apiKey),
    ]);

    return res.status(200).json({
      dealers: dealersWithPhones,
      specialty: specialtyWithPhones,
      quickService: quickServiceWithPhones,
    });
  } catch (err) {
    console.error("nearby-shops error:", err);
    return res.status(500).json({ error: "Search failed." });
  }
}