// Generates public, search-engine-friendly spec pages for every model in
// Wrenched's database, straight from the data in src/App.jsx:
//
//   dist/specs/index.html                       all brands
//   dist/specs/<brand>/index.html               all models for a brand
//   dist/specs/<brand>/<model>/index.html       torque specs, maintenance
//                                               schedule, generations, mods
//   dist/sitemap.xml, dist/robots.txt
//
// Runs after `vite build` on Vercel only (see vercel.json buildCommand), so
// the iPhone/Android app bundles don't carry ~700 extra HTML files.
//
// Usage: node scripts/build-spec-pages.mjs [outDir=dist]

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const SITE = "https://wrenched.shop";
const ADSENSE_CLIENT = "ca-pub-5823580625659011";
const OUT = path.resolve(process.argv[2] || "dist");
const SRC = fs.readFileSync(path.resolve("src/App.jsx"), "utf8");
const lines = SRC.split("\n");

// ── Pull the data constants out of App.jsx ─────────────────────────────────
// Each is a top-level `const NAME = {` / `[` / `(` block that ends at the
// first column-0 `};` / `];` after it. That's how the file is formatted, and
// we fail loudly if that ever changes.
function slice(name, closer) {
  const start = lines.findIndex((l) => new RegExp(`^const ${name}\\s*=`).test(l));
  if (start < 0) throw new Error(`Couldn't find const ${name} in App.jsx`);
  if (!closer) return lines[start]; // one-line const
  const end = lines.findIndex((l, i) => i > start && l === closer);
  if (end < 0) throw new Error(`Couldn't find end of ${name}`);
  return lines.slice(start, end + 1).join("\n");
}
const code = [
  slice("VEHICLES", "};"),
  slice("TORQUE_SPECS", "};"),
  slice("CATALOG", "};"),
  slice("rotationNote", "};"),
  slice("isElectric", "};"),
  slice("MAINTENANCE_CATEGORIES", null),
  slice("MAINTENANCE_ITEMS_GAS", "];"),
  slice("MAINTENANCE_ITEMS_EV", "];"),
  "({VEHICLES,TORQUE_SPECS,CATALOG,isElectric,MAINTENANCE_CATEGORIES,MAINTENANCE_ITEMS_GAS,MAINTENANCE_ITEMS_EV})",
].join("\n");
const D = vm.runInNewContext(code, {});

// ── Helpers ────────────────────────────────────────────────────────────────
const slug = (s) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtMiles = (n) => (n ? n.toLocaleString("en-US") + " mi" : "—");
const fmtMonths = (n) => (!n ? "—" : n % 12 === 0 ? `${n / 12} yr${n === 12 ? "" : "s"}` : `${n} mo`);

// Normalize a model entry into a list of generations (some models have one
// flat set of years/trims, others are split into generations).
function generationsOf(model) {
  if (model.generations) {
    return Object.entries(model.generations).map(([name, g]) => ({ name, ...g }));
  }
  return [{ name: null, years: model.years, trims: model.trims }];
}
function yearRange(gens) {
  const ys = gens.flatMap((g) => g.years || []).map(Number).filter(Boolean);
  if (!ys.length) return "";
  const a = Math.min(...ys), b = Math.max(...ys);
  return a === b ? `${a}` : `${a}–${b}`;
}
function representativeCar(gens) {
  // Latest generation's first trim — used to tailor the maintenance notes.
  const g = gens[gens.length - 1];
  const [, t] = Object.entries(g.trims || {})[0] || [];
  return t ? { engine: t.engine, drivetrain: t.drivetrain, transmission: (t.transmissions || [t.transmission])[0] } : {};
}
function maintenanceFor(car) {
  const ev = D.isElectric(car);
  const base = ev ? D.MAINTENANCE_ITEMS_EV : D.MAINTENANCE_ITEMS_GAS;
  const items = car.drivetrain === "FWD" && !ev ? base.filter((i) => i.key !== "difffluid") : base;
  return items.map((i) => ({ ...i, noteText: typeof i.notes === "function" ? i.notes(car) : i.notes }));
}

// ── Page shell ─────────────────────────────────────────────────────────────
const CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;background:#0D0D0D;color:#C8C4BC;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6}
a{color:#FF6B2B}
.wrap{max-width:860px;margin:0 auto;padding:0 20px}
header.top{border-bottom:1px solid #222;padding:16px 0}
header.top .wrap{display:flex;justify-content:space-between;align-items:center;gap:12px}
.logo{font-family:'Bebas Neue',Impact,sans-serif;font-size:28px;letter-spacing:1px;color:#E8E4DC;text-decoration:none}
.logo span{color:#FF6B2B}
.btn{display:inline-block;background:#FF6B2B;color:#0D0D0D;font-family:'Bebas Neue',Impact,sans-serif;letter-spacing:1.5px;font-size:16px;padding:10px 18px;border-radius:4px;text-decoration:none}
.crumbs{font-size:13px;color:#777;margin:22px 0 6px}
.crumbs a{color:#999;text-decoration:none}
h1,h2{font-family:'Bebas Neue',Impact,sans-serif;color:#E8E4DC;letter-spacing:1px;font-weight:400;line-height:1.1}
h1{font-size:44px;margin:4px 0 10px}
h2{font-size:28px;margin:40px 0 12px;color:#FF6B2B}
h3{color:#E8E4DC;font-size:17px;margin:22px 0 8px}
.lede{font-size:17px;color:#A8A49C}
table{width:100%;border-collapse:collapse;margin:8px 0 4px;font-size:15px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #222;vertical-align:top}
th{color:#888;font-weight:600;font-size:12px;letter-spacing:1px;text-transform:uppercase}
td.spec{color:#FF6B2B;font-weight:700;white-space:nowrap}
td.nc{color:#888;white-space:nowrap}
.note{font-size:13px;color:#888;margin-top:4px}
.size{font-size:13px;color:#A8A49C;margin-top:4px}
.card{background:#141414;border:1px solid #222;border-radius:8px;padding:18px 20px;margin:28px 0}
.cta{background:#151210;border:1px solid #3A2A20;border-radius:8px;padding:22px;margin:36px 0;text-align:center}
.cta p{margin:0 0 14px;color:#C8C4BC}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;padding:0;list-style:none}
.grid a{display:block;background:#141414;border:1px solid #222;border-radius:6px;padding:10px 12px;text-decoration:none;color:#E8E4DC}
.grid a small{display:block;color:#777}
.mods li{margin:4px 0}
.ad{margin:32px 0;min-height:1px}
footer{border-top:1px solid #222;margin-top:48px;padding:24px 0;font-size:13px;color:#666}
footer a{color:#888;margin-right:14px}
@media(max-width:600px){h1{font-size:34px}th,td{padding:8px 6px;font-size:14px}}
`;

function page({ title, description, canonical, body, jsonld = [] }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="google-adsense-account" content="${ADSENSE_CLIENT}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Wrenched">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n")}
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="logo" href="/">WRENCH<span>ED</span></a>
  <a class="btn" href="/">Get the app</a>
</div></header>
<main class="wrap">
${body}
</main>
<footer><div class="wrap">
  <a href="/specs/">All car specs</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="/support.html">Support</a>
  <p>Specs marked "Not confirmed" are ones we haven't been able to verify from a solid source — always double-check against your owner's manual. © ${new Date().getFullYear()} Wrenched</p>
</div></footer>
</body>
</html>
`;
}
const crumbsLd = (items) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: url })),
});
const cta = (carName) => `
<div class="cta">
  <p>Track ${carName ? `your ${esc(carName)}'s` : "your car's"} mileage, service history, and mods — and get reminded before anything's overdue.</p>
  <a class="btn" href="/">Start tracking free</a>
</div>`;

function write(rel, html) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

// ── Build ──────────────────────────────────────────────────────────────────
const urls = [`${SITE}/`, `${SITE}/specs/`];
const brands = Object.keys(D.VEHICLES).sort((a, b) => a.localeCompare(b));
let modelCount = 0;

for (const brand of brands) {
  const bSlug = slug(brand);
  const models = Object.keys(D.VEHICLES[brand]).sort((a, b) => a.localeCompare(b));
  const modelLinks = [];

  for (const model of models) {
    const mSlug = slug(model);
    const entry = D.VEHICLES[brand][model];
    const gens = generationsOf(entry);
    const years = yearRange(gens);
    const full = `${brand} ${model}`;
    const url = `${SITE}/specs/${bSlug}/${mSlug}/`;
    const torque = D.TORQUE_SPECS?.[brand]?.[model] || [];
    const mods = D.CATALOG?.[brand]?.[model] || [];
    const car = representativeCar(gens);
    const maint = maintenanceFor(car);
    const lug = torque.find((t) => /lug/i.test(t.partName) && t.spec && !/not confirmed/i.test(t.spec));
    modelLinks.push({ model, mSlug, years });
    modelCount++;

    const title = `${full}${years ? ` (${years})` : ""} Torque Specs & Maintenance Schedule | Wrenched`;
    const description = `${full} torque specs${lug ? ` (lug nuts: ${lug.spec} ${lug.unit})` : ""}, maintenance intervals, engines and trims${years ? ` for ${years}` : ""}. Honest data — unconfirmed specs are clearly marked.`;

    const torqueHtml = torque.length
      ? `<table><thead><tr><th>Part</th><th>Torque</th></tr></thead><tbody>
${torque.map((t) => {
  const nc = !t.spec || /not confirmed/i.test(t.spec);
  return `<tr><td>${esc(t.partName)}${t.size ? `<div class="size">Socket / thread: ${esc(t.size)}</div>` : ""}${t.notes ? `<div class="note">${esc(t.notes)}</div>` : ""}</td><td class="${nc ? "nc" : "spec"}">${nc ? "Not confirmed" : `${esc(t.spec)} ${esc(t.unit)}`}</td></tr>`;
}).join("\n")}
</tbody></table>`
      : `<p>We don't have verified torque specs for the ${esc(full)} yet. Check your owner's manual, and if you have a solid source, <a href="/support.html">send it over</a>.</p>`;

    const gensHtml = gens.map((g) => {
      const trims = Object.entries(g.trims || {});
      return `${g.name ? `<h3>${esc(g.name)}</h3>` : ""}
<p class="note">Model years: ${esc((g.years || []).join(", ") || "—")}</p>
<table><thead><tr><th>Trim</th><th>Engine</th><th>Drive</th><th>Transmission</th></tr></thead><tbody>
${trims.map(([tn, t]) => `<tr><td>${esc(tn)}</td><td>${esc(t.engine)}</td><td>${esc(t.drivetrain)}</td><td>${esc((t.transmissions || (t.transmission ? [t.transmission] : [])).join(" / "))}</td></tr>`).join("\n")}
</tbody></table>`;
    }).join("\n");

    const maintHtml = D.MAINTENANCE_CATEGORIES.map((cat) => {
      const rows = maint.filter((m) => m.category === cat);
      if (!rows.length) return "";
      return `<h3>${esc(cat)}</h3><table><thead><tr><th>Service</th><th>Every</th><th>Or every</th></tr></thead><tbody>
${rows.map((m) => `<tr><td>${esc(m.name)}${m.noteText ? `<div class="note">${esc(m.noteText)}</div>` : ""}</td><td>${fmtMiles(m.mileInterval)}</td><td>${fmtMonths(m.monthInterval)}</td></tr>`).join("\n")}
</tbody></table>`;
    }).join("\n");

    const modsByCat = {};
    for (const m of mods) (modsByCat[m.category] ||= []).push(m);
    const modsHtml = mods.length
      ? `<h2>Popular ${esc(model)} mods</h2>
<p>Parts owners commonly run on the ${esc(full)}, grouped by type. Always confirm fitment for your exact year and trim.</p>
${Object.entries(modsByCat).map(([cat, list]) => `<h3>${esc(cat)}</h3><ul class="mods">${list.map((m) => `<li><strong>${esc(m.brand)}</strong> — ${esc(m.part)}${m.note ? ` <span class="note">(${esc(m.note)})</span>` : ""}</li>`).join("")}</ul>`).join("\n")}`
      : "";

    const siblings = models.filter((m) => m !== model).slice(0, 12)
      .map((m) => `<li><a href="/specs/${bSlug}/${slug(m)}/">${esc(m)}</a></li>`).join("");

    const body = `
<div class="crumbs"><a href="/specs/">Specs</a> › <a href="/specs/${bSlug}/">${esc(brand)}</a> › ${esc(model)}</div>
<h1>${esc(full)} Specs${years ? ` <span style="color:#777">${esc(years)}</span>` : ""}</h1>
<p class="lede">Torque specs, maintenance intervals, and every engine and trim for the ${esc(full)} — with unconfirmed numbers clearly marked instead of guessed.</p>

<h2>Torque specs</h2>
${torqueHtml}


<h2>Maintenance schedule</h2>
<p>Typical intervals for the ${esc(full)}${car.engine ? ` (${esc(car.engine)}, ${esc(car.drivetrain || "")})` : ""}. Whichever comes first — miles or time. Your owner's manual has the final word, especially under severe driving conditions.</p>
${maintHtml}
${cta(full)}
<h2>Engines, trims & generations</h2>
${gensHtml}
${modsHtml}
${siblings ? `<h2>More ${esc(brand)} specs</h2><ul class="grid">${siblings}</ul><p><a href="/specs/${bSlug}/">All ${esc(brand)} models →</a></p>` : ""}
`;
    write(`specs/${bSlug}/${mSlug}/index.html`, page({
      title, description, canonical: url, body,
      jsonld: [crumbsLd([["Specs", `${SITE}/specs/`], [brand, `${SITE}/specs/${bSlug}/`], [model, url]])],
    }));
    urls.push(url);
  }

  // Brand page
  const bUrl = `${SITE}/specs/${bSlug}/`;
  write(`specs/${bSlug}/index.html`, page({
    title: `${brand} Torque Specs & Maintenance Schedules — All Models | Wrenched`,
    description: `Torque specs, maintenance intervals, engines and trims for every ${brand} model in Wrenched — ${models.length} models covered.`,
    canonical: bUrl,
    jsonld: [crumbsLd([["Specs", `${SITE}/specs/`], [brand, bUrl]])],
    body: `
<div class="crumbs"><a href="/specs/">Specs</a> › ${esc(brand)}</div>
<h1>${esc(brand)} specs</h1>
<p class="lede">Pick your ${esc(brand)} for its torque specs, maintenance schedule, and every engine and trim.</p>
<ul class="grid">${modelLinks.map((m) => `<li><a href="/specs/${bSlug}/${m.mSlug}/">${esc(m.model)}${m.years ? `<small>${esc(m.years)}</small>` : ""}</a></li>`).join("")}</ul>
${cta()}`,
  }));
  urls.push(bUrl);
}

// All-brands index
write("specs/index.html", page({
  title: "Car Torque Specs & Maintenance Schedules by Make and Model | Wrenched",
  description: `Torque specs, maintenance intervals, engines and trims for ${modelCount} models across ${brands.length} brands — with unconfirmed specs clearly marked.`,
  canonical: `${SITE}/specs/`,
  body: `
<h1>Car specs by make</h1>
<p class="lede">${modelCount} models across ${brands.length} brands. Real torque specs, maintenance intervals, and honest "not confirmed" labels instead of forum guesswork.</p>
<ul class="grid">${brands.map((b) => `<li><a href="/specs/${slug(b)}/">${esc(b)}<small>${Object.keys(D.VEHICLES[b]).length} models</small></a></li>`).join("")}</ul>
${cta()}`,
}));

// Sitemap + robots
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join("\n")}\n</urlset>\n`);
fs.writeFileSync(path.join(OUT, "robots.txt"),
  `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`Spec pages: ${brands.length} brands, ${modelCount} models, ${urls.length} URLs in sitemap → ${OUT}`);
