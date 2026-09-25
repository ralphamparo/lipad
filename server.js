// Lipad — cheapest flights out of the Philippines.
// No-dependency Node server: serves the static site and proxies the
// Travelpayouts (Aviasales) cheapest-price API so the token never reaches the browser.
//
//   TP_TOKEN=xxxx TP_MARKER=12345 node apps/ph-cheap-flights/server.js 4325
//
// Without TP_TOKEN the API returns sample fares flagged `demo: true`.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ownAds = require("./ads-server");
const fareAlerts = require("./alerts-server");

const ROOT = __dirname;
const PORT = process.env.PORT || process.argv[2] || 4325;
// Optional local secrets file (KEY=value per line, gitignored); real environment variables win.
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch { /* no .env file */ }

const TOKEN = process.env.TP_TOKEN || "";
const MARKER = process.env.TP_MARKER || "";
// Password for /admin.html, where you manage your own ads. Blank disables the admin API entirely.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const CACHE_MS = 30 * 60 * 1000;

const PH_ORIGINS = ["MNL", "CEB", "CRK", "DVO", "ILO", "KLO", "PPS", "TAG"];
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8", // app-ads.txt, robots.txt
};

// Country code -> region bucket used by the UI filters.
const REGIONS = {
  PH: "Philippines",
  SG: "Southeast Asia", MY: "Southeast Asia", TH: "Southeast Asia", VN: "Southeast Asia",
  ID: "Southeast Asia", KH: "Southeast Asia", LA: "Southeast Asia", MM: "Southeast Asia", BN: "Southeast Asia", TL: "Southeast Asia",
  JP: "East Asia", KR: "East Asia", KP: "East Asia", CN: "East Asia", HK: "East Asia", MO: "East Asia", TW: "East Asia", MN: "East Asia",
  IN: "South Asia", LK: "South Asia", MV: "South Asia", NP: "South Asia", BD: "South Asia", PK: "South Asia", BT: "South Asia",
  KZ: "Central Asia", UZ: "Central Asia", KG: "Central Asia", TJ: "Central Asia", TM: "Central Asia", AM: "Central Asia", AZ: "Central Asia", GE: "Central Asia",
  AE: "Middle East", QA: "Middle East", SA: "Middle East", KW: "Middle East", BH: "Middle East", OM: "Middle East", IL: "Middle East", JO: "Middle East", TR: "Middle East", LB: "Middle East", IQ: "Middle East", IR: "Middle East",
  AU: "Oceania", NZ: "Oceania", GU: "Oceania", MP: "Oceania", PW: "Oceania", FJ: "Oceania", PG: "Oceania", CK: "Oceania", FM: "Oceania", MH: "Oceania", PF: "Oceania", SB: "Oceania", TO: "Oceania", VU: "Oceania", WS: "Oceania", NC: "Oceania",
  US: "Americas", CA: "Americas", MX: "Americas", BR: "Americas", AR: "Americas", BS: "Americas", CL: "Americas", CO: "Americas", CR: "Americas", CU: "Americas", EC: "Americas", PA: "Americas", PE: "Americas", DO: "Americas", JM: "Americas", GY: "Americas",
  GB: "Europe", FR: "Europe", DE: "Europe", IT: "Europe", ES: "Europe", NL: "Europe", CH: "Europe", AT: "Europe", GR: "Europe", PT: "Europe", IE: "Europe", FI: "Europe", SE: "Europe", NO: "Europe", DK: "Europe", PL: "Europe", CZ: "Europe", BE: "Europe",
  RU: "Europe", BY: "Europe", UA: "Europe", LT: "Europe", LV: "Europe", EE: "Europe", MD: "Europe", RS: "Europe", HR: "Europe", CY: "Europe", MT: "Europe", RO: "Europe", BG: "Europe", HU: "Europe", SK: "Europe", SI: "Europe", IS: "Europe", LU: "Europe", ME: "Europe", AL: "Europe", BA: "Europe", MK: "Europe",
  EG: "Africa", MA: "Africa", TN: "Africa", ZA: "Africa", KE: "Africa", TZ: "Africa", UG: "Africa", RW: "Africa", ET: "Africa", NG: "Africa", GH: "Africa", CI: "Africa", CM: "Africa", GM: "Africa", SN: "Africa", MG: "Africa", MU: "Africa", SC: "Africa", CV: "Africa",
};

// ---------- reference data (city / airline names) ----------
let ref = null;
async function loadRef() {
  if (ref) return ref;
  const get = (u) => fetch(u).then((r) => r.json()).catch(() => []);
  const [cities, countries, airlines, airports] = await Promise.all([
    get("https://api.travelpayouts.com/data/en/cities.json"),
    get("https://api.travelpayouts.com/data/en/countries.json"),
    get("https://api.travelpayouts.com/data/en/airlines.json"),
    get("https://api.travelpayouts.com/data/en/airports.json"),
  ]);
  const map = (arr, key) => Object.fromEntries(arr.map((x) => [x[key], x]));
  ref = { cities: map(cities, "code"), countries: map(countries, "code"), airlines: map(airlines, "code"), airports: map(airports, "code") };
  return ref;
}

// ---------- shared helpers ----------
const DAY = 864e5;
const MONTHS_AHEAD = 12;
const DAY_SWEEP_MAX = 14; // ranges this short also get per-day lookups for better coverage
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
// Monday of the week containing iso (YYYY-MM-DD).
const weekStart = (iso) => addDays(iso, -((new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7));

function nextMonths(n) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
}

// Cache with in-flight de-duplication: concurrent callers share one upstream job.
const cache = new Map();
const inflight = new Map();
function cached(key, fn, { force = false } = {}) {
  const hit = cache.get(key);
  if (!force && hit && Date.now() < hit.expires) return Promise.resolve(hit.value);
  if (inflight.has(key)) return inflight.get(key);
  const job = fn()
    .then(({ value, ttl }) => { cache.set(key, { value, expires: Date.now() + ttl }); return value; })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

// ---------- live data ----------
// Travelpayouts only knows fares travellers recently found, so one query misses a lot.
// A "sweep" combines two price pools (v3 prices_for_dates overall + per month, and v2 prices/latest)
// into one list of fares for the next 12 months; every date filter is then applied to that list.

// Small concurrency limiter so a full sweep doesn't trip the API's rate limit.
function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
const limit = limiter(5);

async function tpGet(pathname, params) {
  // Token goes in a header, not the URL, so it can't leak into logs or error messages.
  const url = "https://api.travelpayouts.com" + pathname + "?" + new URLSearchParams(params);
  for (let attempt = 0; ; attempt++) {
    const res = await limit(() => fetch(url, { headers: { "X-Access-Token": TOKEN } }));
    if (res.status === 429 && attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`Travelpayouts ${pathname} ${res.status}`);
    return (await res.json()).data || [];
  }
}

const ddmm = (iso) => iso.slice(8, 10) + iso.slice(5, 7);
// "{adults}" is filled in by the browser so the passenger count isn't part of the cache key.
// Prefers the API's own link (it opens that exact fare); its path ends with the passenger count, e.g. /search/MNL2301HKG25011.
function aviasalesLink(origin, dest, departAt, returnAt, apiLink) {
  const withMarker = (link) => (MARKER ? link + (link.includes("?") ? "&" : "?") + "marker=" + MARKER : link);
  const m = apiLink && /^(\/search\/[A-Z]{3}\d{4}[A-Z]{3}(?:\d{4})?)\d(\?.*)?$/.exec(apiLink);
  if (m) return withMarker(`https://www.aviasales.com${m[1]}{adults}${m[2] || ""}`);
  return withMarker(`https://www.aviasales.com/search/${origin}${ddmm(departAt)}${dest}${returnAt ? ddmm(returnAt) : ""}{adults}`);
}

const v3Row = (d) => ({
  origin: d.origin, destination: d.destination, destinationAirport: d.destination_airport, price: d.price,
  airline: d.airline, departAt: d.departure_at, returnAt: d.return_at || null, stops: d.transfers || 0, link: d.link,
});
// unique=true returns only the cheapest fare per destination; pass { unique: "false" } for alternative dates too.
const v3 = (base, direct, departure_at, extra = {}) => tpGet("/aviasales/v3/prices_for_dates", {
  ...base, sorting: "price", unique: "true", limit: "1000", direct: String(direct), ...(departure_at && { departure_at }), ...extra,
}).then((rows) => rows.map(v3Row));

// Runs jobs, tolerating partial failure; throws only if every job failed.
async function settle(jobs) {
  if (!jobs.length) return [];
  const settled = await Promise.allSettled(jobs);
  const failed = settled.filter((x) => x.status === "rejected");
  failed.forEach((f) => console.error(f.reason.message));
  if (failed.length === settled.length) throw failed[0].reason;
  return settled.flatMap((x) => (x.status === "fulfilled" ? x.value : []));
}

async function decorate(rows, { oneWay, direct }) {
  const r = await loadRef();
  const today = todayIso();
  return rows
    .filter((d) => d.price && d.departAt && d.departAt.slice(0, 10) >= today && !(direct && d.stops > 0) && (oneWay || d.returnAt))
    .map((d) => {
      const city = r.cities[d.destination] || {};
      const country = city.country_code || (r.airports[d.destinationAirport || d.destination] || {}).country_code || "";
      return {
        origin: d.origin,
        originName: (r.cities[d.origin] || {}).name || d.origin,
        destination: d.destination,
        destinationName: city.name || d.destination,
        country,
        countryName: (r.countries[country] || {}).name || country,
        region: REGIONS[country] || "Other",
        price: d.price,
        airline: d.airline,
        airlineName: d.airline ? (r.airlines[d.airline] || {}).name || d.airline : "Various airlines",
        departAt: d.departAt,
        returnAt: d.returnAt,
        stops: d.stops,
        link: aviasalesLink(d.origin, d.destination, d.departAt, d.returnAt, d.link),
      };
    });
}

const originsFor = (origin) => (origin === "ALL" ? PH_ORIGINS : [origin]);

async function liveSweep({ origin, oneWay, direct }) {
  const jobs = [];
  for (const o of originsFor(origin)) {
    const base = { origin: o, currency: "php", one_way: String(oneWay) };
    jobs.push(v3(base, direct));
    // Per month, twice: unique=true reaches the most destinations; unique=false adds alternative dates to
    // popular ones (it fills its limit with cheap routes), which gives date filters more to choose from.
    for (const m of nextMonths(MONTHS_AHEAD)) {
      jobs.push(v3(base, direct, m));
      jobs.push(v3(base, direct, m, { unique: "false" }));
    }
    // v2: a separate pool of recently found fares; often has destinations v3 lacks.
    jobs.push(tpGet("/v2/prices/latest", { ...base, sorting: "price", limit: "1000", show_to_affiliates: "true", period_type: "year" })
      .then((rows) => rows.map((d) => ({
        origin: d.origin, destination: d.destination, price: d.value, airline: "",
        departAt: d.depart_date, returnAt: d.return_date || null, stops: d.number_of_changes || 0,
      }))));
  }
  return decorate(await settle(jobs), { oneWay, direct });
}

// Per-day lookups for one origin and day, cached separately so overlapping week/custom ranges reuse them.
function liveDay(o, day, { oneWay, direct }) {
  const key = JSON.stringify(["day", o, day, oneWay, direct]);
  return cached(key, async () => {
    const rows = await v3({ origin: o, currency: "php", one_way: String(oneWay) }, direct, day);
    return { value: await decorate(rows, { oneWay, direct }), ttl: CACHE_MS };
  });
}

// Every known fare on one route (origin -> dest) for the next year, for the "all fares to X" view.
// grouped_prices gives the cheapest one-way fare for each departure day; prices_for_dates adds round trips and alternatives.
function liveRoute(o, dest, { oneWay, direct }) {
  const key = JSON.stringify(["route", o, dest, oneWay, direct]);
  return cached(key, async () => {
    const base = { origin: o, destination: dest, currency: "php", one_way: String(oneWay) };
    const jobs = [v3(base, direct, "", { unique: "false" })];
    if (oneWay) {
      jobs.push(tpGet("/aviasales/v3/grouped_prices", { origin: o, destination: dest, currency: "php", group_by: "departure_at", direct: String(direct) })
        .then((data) => Object.values(data).map(v3Row)));
    } else {
      for (const m of nextMonths(MONTHS_AHEAD)) jobs.push(v3(base, direct, m, { unique: "false" }));
    }
    return { value: await decorate(await settle(jobs), { oneWay, direct }), ttl: CACHE_MS };
  });
}

// ---------- sample data (no token) ----------
const AIRLINES = { "5J": "Cebu Pacific", PR: "Philippine Airlines", Z2: "AirAsia Philippines", DG: "Cebgo", TR: "Scoot", AK: "AirAsia", VJ: "VietJet Air", "7C": "Jeju Air", TW: "T'way Air", MM: "Peach", CX: "Cathay Pacific", EK: "Emirates", QR: "Qatar Airways", SV: "Saudia", JQ: "Jetstar", UA: "United Airlines", KE: "Korean Air", MU: "China Eastern", BR: "EVA Air", SQ: "Singapore Airlines", FD: "Thai AirAsia", QZ: "Indonesia AirAsia" };
const CITY = {
  MNL: ["Manila", "PH"], CEB: ["Cebu", "PH"], CRK: ["Clark", "PH"], DVO: ["Davao", "PH"], ILO: ["Iloilo", "PH"], KLO: ["Kalibo (Boracay)", "PH"],
  PPS: ["Puerto Princesa", "PH"], TAG: ["Bohol–Panglao", "PH"], MPH: ["Caticlan (Boracay)", "PH"], IAO: ["Siargao", "PH"], BCD: ["Bacolod", "PH"], CGY: ["Cagayan de Oro", "PH"], ENI: ["El Nido", "PH"],
  HKG: ["Hong Kong", "HK"], MFM: ["Macau", "MO"], TPE: ["Taipei", "TW"], KHH: ["Kaohsiung", "TW"], SIN: ["Singapore", "SG"], KUL: ["Kuala Lumpur", "MY"], BKI: ["Kota Kinabalu", "MY"],
  BKK: ["Bangkok", "TH"], HKT: ["Phuket", "TH"], SGN: ["Ho Chi Minh City", "VN"], HAN: ["Hanoi", "VN"], DAD: ["Da Nang", "VN"], PNH: ["Phnom Penh", "KH"], CGK: ["Jakarta", "ID"], DPS: ["Bali", "ID"],
  TYO: ["Tokyo", "JP"], OSA: ["Osaka", "JP"], NGO: ["Nagoya", "JP"], FUK: ["Fukuoka", "JP"], SPK: ["Sapporo", "JP"], OKA: ["Okinawa", "JP"],
  SEL: ["Seoul", "KR"], PUS: ["Busan", "KR"], CJU: ["Jeju", "KR"], SHA: ["Shanghai", "CN"], BJS: ["Beijing", "CN"], XMN: ["Xiamen", "CN"],
  DXB: ["Dubai", "AE"], DOH: ["Doha", "QA"], RUH: ["Riyadh", "SA"], JED: ["Jeddah", "SA"], KWI: ["Kuwait City", "KW"],
  SYD: ["Sydney", "AU"], MEL: ["Melbourne", "AU"], BNE: ["Brisbane", "AU"], GUM: ["Guam", "GU"],
  HNL: ["Honolulu", "US"], LAX: ["Los Angeles", "US"], SFO: ["San Francisco", "US"], YVR: ["Vancouver", "CA"], YYZ: ["Toronto", "CA"], LON: ["London", "GB"], DEL: ["New Delhi", "IN"],
};
const COUNTRY_NAMES = { PH: "Philippines", HK: "Hong Kong", MO: "Macau", TW: "Taiwan", SG: "Singapore", MY: "Malaysia", TH: "Thailand", VN: "Vietnam", KH: "Cambodia", ID: "Indonesia", JP: "Japan", KR: "South Korea", CN: "China", AE: "United Arab Emirates", QA: "Qatar", SA: "Saudi Arabia", KW: "Kuwait", AU: "Australia", GU: "Guam", US: "United States", CA: "Canada", GB: "United Kingdom", IN: "India" };

// [destination, one-way base fare PHP, airline, stops]
const SAMPLE_ROUTES = {
  MNL: [["CEB", 1299, "5J", 0], ["DVO", 1899, "5J", 0], ["MPH", 1799, "DG", 0], ["PPS", 1499, "Z2", 0], ["IAO", 2499, "5J", 0], ["TAG", 1399, "PR", 0], ["ENI", 4899, "PR", 0], ["BCD", 1599, "5J", 0], ["CGY", 1699, "Z2", 0],
    ["HKG", 3499, "5J", 0], ["MFM", 2999, "5J", 0], ["TPE", 3899, "Z2", 0], ["KHH", 3599, "5J", 0], ["SIN", 3999, "TR", 0], ["KUL", 3199, "AK", 0], ["BKK", 4299, "Z2", 0], ["SGN", 3299, "VJ", 0], ["HAN", 3699, "5J", 0], ["DAD", 4799, "5J", 0],
    ["PNH", 4999, "5J", 0], ["CGK", 5299, "5J", 0], ["DPS", 5999, "Z2", 0], ["TYO", 6999, "5J", 0], ["OSA", 6499, "MM", 0], ["NGO", 6799, "5J", 0], ["FUK", 6999, "5J", 0], ["SPK", 8999, "PR", 0], ["OKA", 5799, "5J", 0],
    ["SEL", 5499, "7C", 0], ["PUS", 5999, "TW", 0], ["SHA", 6299, "MU", 0], ["BJS", 8499, "PR", 0], ["XMN", 5299, "PR", 0], ["GUM", 9999, "UA", 0], ["SYD", 12999, "5J", 0], ["MEL", 13999, "PR", 0], ["BNE", 13499, "PR", 0],
    ["DXB", 11999, "5J", 0], ["DOH", 13499, "QR", 0], ["RUH", 14999, "PR", 0], ["JED", 15999, "SV", 0], ["KWI", 14499, "5J", 0], ["HNL", 18999, "PR", 0], ["LAX", 24999, "PR", 0], ["SFO", 25999, "PR", 0],
    ["YVR", 27999, "PR", 0], ["YYZ", 32999, "PR", 1], ["LON", 29999, "EK", 1], ["DEL", 12999, "SQ", 1]],
  CEB: [["MNL", 1299, "5J", 0], ["DVO", 1199, "5J", 0], ["CGY", 999, "DG", 0], ["IAO", 1599, "5J", 0], ["SEL", 5199, "5J", 0], ["PUS", 5799, "7C", 0], ["TYO", 7499, "5J", 0], ["OSA", 7299, "PR", 0], ["SIN", 4299, "TR", 0],
    ["HKG", 4799, "CX", 0], ["TPE", 4999, "BR", 0], ["BKK", 5499, "Z2", 1], ["DOH", 14999, "QR", 0], ["DXB", 13999, "EK", 1]],
  CRK: [["CEB", 1499, "5J", 0], ["DVO", 2099, "5J", 0], ["SIN", 3899, "TR", 0], ["HKG", 3599, "5J", 0], ["KUL", 3099, "AK", 0], ["SEL", 5899, "TW", 0], ["DXB", 12499, "EK", 0], ["TPE", 3999, "5J", 0], ["BKK", 4399, "FD", 0], ["OSA", 6999, "5J", 1]],
  DVO: [["MNL", 1899, "5J", 0], ["CEB", 1199, "5J", 0], ["CRK", 2099, "5J", 0], ["SIN", 4999, "TR", 0], ["ILO", 1699, "5J", 0]],
  ILO: [["MNL", 1399, "5J", 0], ["CEB", 1099, "DG", 0], ["DVO", 1699, "5J", 0], ["SIN", 5299, "5J", 0], ["HKG", 4999, "5J", 0]],
  KLO: [["MNL", 1799, "Z2", 0], ["SEL", 5999, "Z2", 0], ["PUS", 6299, "Z2", 0], ["SHA", 7999, "MU", 0], ["TPE", 5299, "Z2", 0]],
  PPS: [["MNL", 1499, "5J", 0], ["CEB", 1899, "5J", 0], ["CRK", 2199, "Z2", 0], ["TPE", 5499, "BR", 1]],
  TAG: [["MNL", 1399, "PR", 0], ["CEB", 1799, "DG", 0], ["SEL", 6499, "7C", 0], ["DVO", 2299, "5J", 1]],
};

function seeded(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

// Rough PH travel seasons so sample prices vary believably across the year.
const SEASON = { "01": 1.1, "02": 0.95, "03": 0.95, "04": 1.2, "05": 1.1, "06": 1, "07": 1, "08": 1, "09": 0.9, "10": 0.9, "11": 0.92, "12": 1.35 };

// One seeded fare per route per week for the next 53 weeks.
function sampleRows({ origin, oneWay, direct }) {
  const today = todayIso();
  const firstWeek = weekStart(today);
  const out = [];
  for (const o of originsFor(origin)) {
    for (const [dest, base, airline, stops] of SAMPLE_ROUTES[o] || []) {
      if (direct && stops > 0) continue;
      const [destName, country] = CITY[dest];
      for (let w = 0; w < 53; w++) {
        const rand = seeded(o + dest + w + oneWay);
        const day = addDays(firstWeek, w * 7 + Math.floor(rand() * 7));
        if (day <= today || day > addDays(today, 365)) continue;
        // Local Manila times, formatted like the live API (departure date is the calendar date shown).
        const time = `T${String(5 + Math.floor(rand() * 16)).padStart(2, "0")}:${rand() < 0.5 ? "00" : "30"}:00+08:00`;
        const fare = Math.round((base * (0.78 + rand() * 0.35) * SEASON[day.slice(5, 7)]) / 10) * 10 - 1;
        const ret = oneWay ? null : addDays(day, 2 + Math.floor(rand() * 15));
        out.push({
          origin: o, originName: CITY[o][0], destination: dest, destinationName: destName,
          country, countryName: COUNTRY_NAMES[country] || country, region: REGIONS[country] || "Other",
          price: oneWay ? fare : Math.round(fare * 1.82 / 10) * 10 - 1,
          airline, airlineName: AIRLINES[airline] || airline,
          departAt: day + time, returnAt: ret && ret + time, stops,
          link: "https://www.google.com/travel/flights?hl=en&curr=PHP&q=" + encodeURIComponent(
            `Flights from ${o} to ${dest} on ${day}` + (ret ? ` returning ${ret}` : " one way") + " for ") + "{adults}" + encodeURIComponent(" adults"),
        });
      }
    }
  }
  return out;
}

// ---------- queries ----------
// All fares for the next 12 months for this origin/trip/direct combination. Falls back to sample data.
function getSweep(params, opts) {
  const key = JSON.stringify(["sweep", params.origin, params.oneWay, params.direct]);
  const at = () => new Date().toISOString();
  return cached(key, async () => {
    if (!TOKEN) return { value: { demo: true, error: null, rows: sampleRows(params), at: at() }, ttl: CACHE_MS };
    try {
      return { value: { demo: false, error: null, rows: await liveSweep(params), at: at() }, ttl: CACHE_MS };
    } catch (e) {
      console.error(e);
      // Cache failures briefly, so a bad token or outage doesn't trigger a full sweep on every page view.
      const error = "Live prices unavailable right now — showing sample fares.";
      return { value: { demo: true, error, rows: sampleRows(params), at: at() }, ttl: 2 * 60 * 1000 };
    }
  }, opts);
}

// Nights between departure and return dates (null for one-way fares).
const nightsOf = (d) => (d.returnAt ? daysBetween(d.departAt.slice(0, 10), d.returnAt.slice(0, 10)) : null);
// Round trips only: keep fares whose stay is within [minNights, maxNights] when a trip length is set.
const fitsStay = (d, { minNights, maxNights }) => !maxNights || (d.returnAt && nightsOf(d) >= minNights && nightsOf(d) <= maxNights);

const ROUTE_LIMIT = 300;

// Fares departing within [from, to], optionally returning by returnBy and with a set trip length.
// Normally the cheapest fare per route; with params.dest (up to 3 destinations) every distinct date option instead.
async function getDeals(params) {
  const { from, to, returnBy, dest } = params;
  const sweep = await getSweep(params);
  let rows = sweep.rows;
  if (dest.length) {
    rows = rows.filter((d) => dest.includes(d.destination));
    if (!sweep.demo) {
      const origins = params.origin !== "ALL" ? [params.origin] : [...new Set(rows.map((d) => d.origin))];
      const jobs = dest.flatMap((code) => (origins.length ? origins : ["MNL"]).map((o) => liveRoute(o, code, params)));
      rows = rows.concat(await settle(jobs).catch(() => []));
    }
  } else if (!sweep.demo && from && daysBetween(from, to) < DAY_SWEEP_MAX) {
    const days = Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i));
    const perDay = originsFor(params.origin).flatMap((o) => days.map((day) => liveDay(o, day, params)));
    rows = rows.concat(await settle(perDay).catch(() => []));
  }
  const keyOf = dest.length
    ? (d) => d.origin + d.destination + d.departAt.slice(0, 10) + (d.returnAt || "").slice(0, 10)
    : (d) => d.origin + d.destination;
  const best = new Map();
  for (const d of rows) {
    const day = d.departAt.slice(0, 10);
    if (from && (day < from || day > to)) continue;
    if (returnBy && d.returnAt && d.returnAt.slice(0, 10) > returnBy) continue;
    if (!fitsStay(d, params)) continue;
    const key = keyOf(d);
    if (!best.has(key) || d.price < best.get(key).price) best.set(key, d);
  }
  let deals = [...best.values()].sort((a, b) => a.price - b.price).map((d) => ({ ...d, nights: nightsOf(d) }));
  if (dest.length) deals = deals.slice(0, ROUTE_LIMIT);
  return { demo: sweep.demo, error: sweep.error, updatedAt: sweep.at, params, deals };
}

// ---------- seat sales ----------
// "Cheap" only means something against what a route normally costs: Manila–Tokyo at ₱6,000 is a
// sale, Manila–Cebu at ₱6,000 is a rip-off. We compare each route's cheapest fare with the median
// of every fare we hold for it, and call the big gaps sales.
const MIN_SAMPLES = 4; // fewer than this and the "typical" price is guesswork
const MIN_DISCOUNT = 0.25;

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function getSales(params) {
  const sweep = await getSweep(params);
  const routes = new Map();
  for (const d of sweep.rows) {
    if (!fitsStay(d, params)) continue;
    const key = d.origin + d.destination;
    if (!routes.has(key)) routes.set(key, []);
    routes.get(key).push(d);
  }

  const { from, to } = params;
  const sales = [];
  for (const fares of routes.values()) {
    if (fares.length < MIN_SAMPLES) continue;
    // The baseline is the route's whole history; the sale fare has to fall inside the dates asked for.
    const typical = median(fares.map((f) => f.price));
    const inRange = from ? fares.filter((f) => f.departAt.slice(0, 10) >= from && f.departAt.slice(0, 10) <= to) : fares;
    if (!inRange.length) continue;
    const best = inRange.reduce((a, b) => (b.price < a.price ? b : a));
    const discount = 1 - best.price / typical;
    if (discount < MIN_DISCOUNT) continue;
    sales.push({ ...best, nights: nightsOf(best), typical: Math.round(typical), discount: +(discount * 100).toFixed(0), samples: fares.length });
  }

  // Biggest drops first, and only the ones worth a traveller's attention.
  sales.sort((a, b) => b.discount - a.discount || a.price - b.price);
  return { demo: sweep.demo, error: sweep.error, updatedAt: sweep.at, params, deals: sales.slice(0, 120) };
}

// Cheapest known fare per departure month ("YYYY-MM") or week (Monday "YYYY-MM-DD").
async function getLows(params, unit) {
  const { rows } = await getSweep(params);
  const lows = {};
  for (const d of rows) {
    if (!fitsStay(d, params)) continue;
    const day = d.departAt.slice(0, 10);
    const k = unit === "week" ? weekStart(day) : day.slice(0, 7);
    if (!(lows[k] <= d.price)) lows[k] = d.price;
  }
  return lows;
}

// ---------- http ----------
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "") && !Number.isNaN(Date.parse(v));

function parseParams(url) {
  const q = url.searchParams;
  const origin = (q.get("origin") || "ALL").toUpperCase();
  const params = {
    origin: origin === "ALL" || PH_ORIGINS.includes(origin) ? origin : "ALL",
    oneWay: q.get("trip") !== "round",
    direct: q.get("direct") === "1",
    from: "", to: "", returnBy: "", minNights: 0, maxNights: 0,
    // dest=HKG or dest=TYO,OSA: list every fare to these destinations instead of one per route.
    dest: /^[A-Z]{3}(,[A-Z]{3}){0,2}$/.test(q.get("dest") || "") ? q.get("dest").split(",") : [],
  };
  let from = q.get("from"), to = q.get("to");
  const month = q.get("month");
  if (!isDay(from) && /^\d{4}-\d{2}$/.test(month || "")) { // month=YYYY-MM shorthand
    from = month + "-01";
    to = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
  }
  if (isDay(from) && isDay(to)) {
    if (from > to) [from, to] = [to, from];
    const today = todayIso(), horizon = addDays(today, 366);
    params.from = from < today ? today : from;
    params.to = to > horizon ? horizon : to;
    if (params.from > params.to) params.to = params.from;
  }
  if (!params.oneWay && isDay(q.get("returnBy"))) params.returnBy = q.get("returnBy");
  // Trip length in nights, e.g. nights=6-8 (round trips only).
  const nights = /^(\d{1,2})-(\d{1,2})$/.exec(q.get("nights") || "");
  if (!params.oneWay && nights) {
    params.minNights = Math.min(+nights[1], +nights[2]);
    params.maxNights = Math.max(+nights[1], +nights[2], 1);
  }
  return params;
}

function sendJson(res, promise) {
  promise
    .then((body) => { res.writeHead(200, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); })
    .catch((e) => { console.error(e); res.writeHead(500, { "Content-Type": TYPES[".json"] }).end("{}"); });
}

// Keep the default "all airports" sweeps warm so first visitors don't wait.
function prewarm() {
  if (!TOKEN) return;
  // Forced refresh: visitors keep getting the old cached copy until the new sweep lands.
  for (const oneWay of [true, false]) getSweep({ origin: "ALL", oneWay, direct: false }, { force: true }).catch(() => {});
}
prewarm();
setInterval(prewarm, CACHE_MS - 60 * 1000).unref();
fareAlerts.start(getDeals);

// ---------- your own ads ----------
// Constant-time compare so the password can't be guessed by timing the response.
function adminOk(req) {
  if (!ADMIN_TOKEN) return false;
  const given = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given), b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readJsonBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("Body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

async function handleAdmin(req, res, url) {
  if (!adminOk(req)) {
    res.writeHead(401, { "Content-Type": TYPES[".json"] });
    res.end(JSON.stringify({ error: ADMIN_TOKEN ? "Wrong password." : "Admin is disabled: set ADMIN_TOKEN on the server." }));
    return;
  }
  try {
    if (req.method === "GET" && url.pathname === "/api/admin/ads") {
      return sendJson(res, Promise.resolve({ ads: ownAds.list(), placements: ownAds.PLACEMENTS }));
    }
    if (req.method === "POST" && url.pathname === "/api/admin/ads") {
      const ad = ownAds.upsert(await readJsonBody(req));
      return sendJson(res, Promise.resolve({ ad }));
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/ads/")) {
      const ok = ownAds.remove(url.pathname.split("/").pop());
      return sendJson(res, Promise.resolve({ ok }));
    }
    res.writeHead(404, { "Content-Type": TYPES[".json"] }).end('{"error":"Not found"}');
  } catch (e) {
    res.writeHead(400, { "Content-Type": TYPES[".json"] });
    res.end(JSON.stringify({ error: e.message }));
  }
}

// ---------- fare alerts ----------
async function handleAlertSignup(req, res) {
  const reply = (code, body) => {
    res.writeHead(code, { "Content-Type": TYPES[".json"] });
    res.end(JSON.stringify(body));
  };
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  try {
    await fareAlerts.subscribe(await readJsonBody(req, 8 * 1024));
    reply(200, { ok: true, message: "Check your inbox and click the confirmation link." });
  } catch (e) {
    reply(400, { error: e.message });
  }
}

// Small standalone page for the links inside alert emails.
const alertPage = (found, confirmed) => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Lipad fare alerts</title>
<link rel="stylesheet" href="/styles.css"><body><main class="wrap prose" style="padding:48px 20px">
<h1>${!found ? "That link has expired" : confirmed ? "Alert confirmed" : "Alert removed"}</h1>
<p>${!found
  ? "It may already have been used, or the alert was removed."
  : confirmed
    ? "We'll email you when a fare drops below your target. Prices move fast, so act quickly when one lands."
    : "You won't get any more emails about this alert."}</p>
<p><a href="/">← Back to Lipad</a></p></main>`;

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/deals") return sendJson(res, getDeals(parseParams(url)));
  if (url.pathname === "/api/lows") return sendJson(res, getLows(parseParams(url), url.searchParams.get("unit") === "week" ? "week" : "month"));
  if (url.pathname === "/api/sales") return sendJson(res, getSales(parseParams(url)));
  if (url.pathname === "/api/ads") {
    const placements = (url.searchParams.get("placements") || "").split(",").filter((p) => ownAds.PLACEMENTS.includes(p));
    return sendJson(res, Promise.resolve(ownAds.serve({
      placements, region: url.searchParams.get("region") || "", dest: (url.searchParams.get("dest") || "").toUpperCase(),
    })));
  }
  if (url.pathname.startsWith("/go/")) { // click-through, counted then redirected
    const target = ownAds.click(url.pathname.slice(4));
    res.writeHead(target ? 302 : 404, target ? { Location: target } : {});
    return res.end();
  }
  if (url.pathname.startsWith("/api/admin/")) return void handleAdmin(req, res, url);
  if (url.pathname === "/api/alerts/status") return sendJson(res, Promise.resolve({ enabled: fareAlerts.enabled() }));
  if (url.pathname === "/api/alerts") return void handleAlertSignup(req, res);
  if (url.pathname === "/alerts/confirm" || url.pathname === "/alerts/unsubscribe") {
    const done = url.pathname.endsWith("confirm")
      ? fareAlerts.confirm(url.searchParams.get("t"))
      : fareAlerts.unsubscribe(url.searchParams.get("t"));
    const confirmed = url.pathname.endsWith("confirm");
    res.writeHead(done ? 200 : 404, { "Content-Type": TYPES[".html"] });
    res.end(alertPage(done, confirmed));
    return;
  }

  let p = decodeURIComponent(url.pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(ROOT, path.normalize(p));
  // Only serve the site's own web files: never server.js, .env or other dotfiles, docs,
  // the ad database in data/, or any other server-side code.
  const name = path.basename(file);
  // .json is a response type for the API, never a file to hand out (package.json, lockfiles, ad data).
  const blocked = ["server.js", "ads-server.js"];
  if (!file.startsWith(ROOT + path.sep) || name.startsWith(".") || blocked.includes(name) ||
      p.startsWith("/data/") || path.extname(name) === ".json" || !TYPES[path.extname(name)]) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, () => {
  // Hosts like Render publish the real address in an env var; locally it's just localhost.
  const url = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`) ||
    `http://localhost:${PORT}`;
  console.log(`Lipad on ${url} (${TOKEN ? "live Travelpayouts prices" : "sample prices — set TP_TOKEN for live"}` +
    `${MARKER ? `, marker ${MARKER}` : ", no TP_MARKER: bookings earn nothing"}` +
    `${ADMIN_TOKEN ? "" : ", admin disabled"})`);
});
