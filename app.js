const $ = (id) => document.getElementById(id);
const CONFIG = window.LIPAD || {};
// Blank for the website; a packaged Android/iOS build points this at the deployed server.
const API = (CONFIG.apiBase || "").replace(/\/$/, "");
const REGION_ORDER = ["Philippines", "Southeast Asia", "East Asia", "South Asia", "Central Asia", "Middle East", "Oceania", "Americas", "Europe", "Africa", "Other"];
const BANDS = { Philippines: "--r-ph", "Southeast Asia": "--r-sea", "East Asia": "--r-ea", "Middle East": "--r-me", Oceania: "--r-oc", Americas: "--r-am", Europe: "--r-eu", "Central Asia": "--r-ca", Africa: "--r-af" };
const peso = (n) => "₱" + Math.round(n).toLocaleString("en-PH");

// ---------- calendar-date helpers (plain YYYY-MM-DD strings, no time zones) ----------
const pad = (n) => String(n).padStart(2, "0");
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, n) => { const d = parseIso(iso); d.setDate(d.getDate() + n); return toIso(d); };
const weekStart = (iso) => addDays(iso, -((parseIso(iso).getDay() + 6) % 7)); // Monday
const monthEnd = (ym) => toIso(new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0));
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
const TODAY = toIso(new Date());
const HORIZON = addDays(TODAY, 365);
const MONTHS = Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + i); return toIso(d).slice(0, 7); });
const WEEKS = Array.from({ length: 52 }, (_, i) => addDays(weekStart(TODAY), i * 7));

const short = (iso, opts) => parseIso(iso).toLocaleDateString("en-PH", opts);
// Fare timestamps carry the local departure date first ("2026-10-12T08:00:00+08:00"); show that date as-is.
const fmtDate = (stamp) => short(stamp.slice(0, 10), { weekday: "short", day: "numeric", month: "short" });
function fmtRange(from, to) {
  if (from === to) return short(from, { month: "short", day: "numeric", year: "numeric" });
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${short(from, { month: "short", day: "numeric" })}–${+to.slice(8)}, ${from.slice(0, 4)}`;
  return `${short(from, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })} – ${short(to, { month: "short", day: "numeric", year: "numeric" })}`;
}

const state = {
  deals: [], region: "All", trip: "oneway",
  when: "any", month: MONTHS[0], week: WEEKS[0], from: "", to: "", returnBy: "",
  lows: {}, lowsKey: "",
};

// ---------- restore filters from the URL so searches are shareable ----------
const qs = new URLSearchParams(location.search);
if (qs.get("from") && qs.get("from").length === 3) $("origin").value = qs.get("from"); // airport code
if (qs.get("trip") === "round") state.trip = "round";
if (qs.get("direct") === "1") $("direct").checked = true;
if (/^[1-9]$/.test(qs.get("adults") || "")) $("adults").value = qs.get("adults");
if (qs.get("region")) state.region = qs.get("region");
if (MONTHS.includes(qs.get("month"))) { state.when = "month"; state.month = qs.get("month"); }
if (WEEKS.includes(qs.get("week"))) { state.when = "week"; state.week = qs.get("week"); }
if (isDay(qs.get("depart")) && isDay(qs.get("until"))) {
  state.when = "custom"; state.from = qs.get("depart"); state.to = qs.get("until");
  if (isDay(qs.get("returnBy"))) state.returnBy = qs.get("returnBy");
}
if (qs.get("when") === "any") state.when = "any";
if (state.trip === "round" && /^\d{1,2}-\d{1,2}$/.test(qs.get("nights") || "")) {
  const preset = [...$("stay").options].find((o) => o.value === qs.get("nights"));
  if (preset) $("stay").value = preset.value;
  else { $("stay").value = "custom"; [$("nMin").value, $("nMax").value] = qs.get("nights").split("-"); }
}

// Trip length as "min-max" nights, or "" for any length. Only applies to round trips.
function nights() {
  if (state.trip !== "round" || !$("stay").value) return "";
  if ($("stay").value !== "custom") return $("stay").value;
  const clamp = (v) => Math.min(30, Math.max(1, Math.round(Number(v)) || 1));
  const a = clamp($("nMin").value), b = clamp($("nMax").value);
  return `${Math.min(a, b)}-${Math.max(a, b)}`;
}
const nightsLabel = (n) => { const [a, b] = n.split("-"); return a === b ? `${a}-night` : `${a}–${b} night`; };

const adults = () => Number($("adults").value);
// Budget is for the whole party, so the slider's range scales with the number of adults.
function scaleBudget() {
  $("budget").max = String(40000 * adults());
  // min == step keeps max on the step grid, so the slider can still reach "Any".
  $("budget").min = $("budget").step = String(500 * adults());
}
scaleBudget();
$("budget").value = qs.get("max") || $("budget").max;

function syncUrl() {
  const p = new URLSearchParams();
  if ($("origin").value !== "ALL") p.set("from", $("origin").value);
  if (state.trip === "round") p.set("trip", "round");
  if (nights()) p.set("nights", nights());
  if (state.when === "month") p.set("month", state.month);
  if (state.when === "week") p.set("week", state.week);
  if (state.when === "custom" && state.from) {
    p.set("depart", state.from); p.set("until", state.to);
    if (state.trip === "round" && state.returnBy) p.set("returnBy", state.returnBy);
  }
  if ($("direct").checked) p.set("direct", "1");
  if ($("budget").value !== $("budget").max) p.set("max", $("budget").value);
  if (adults() > 1) p.set("adults", adults());
  if (state.region !== "All") p.set("region", state.region);
  history.replaceState(null, "", p.toString() ? "?" + p : location.pathname);
}

// The departure window for the current date mode, or null for "any dates".
function range() {
  if (state.when === "month") return { from: state.month + "-01", to: monthEnd(state.month) };
  if (state.when === "week") return { from: state.week, to: addDays(state.week, 6) };
  if (state.when === "custom" && state.from && state.to) return { from: state.from, to: state.to, returnBy: state.trip === "round" ? state.returnBy : "" };
  return null;
}
function rangeLabel() {
  const r = range();
  if (!r) return "the next 12 months";
  if (state.when === "month") return short(state.month + "-01", { month: "long", year: "numeric" });
  return fmtRange(r.from < TODAY ? TODAY : r.from, r.to);
}

const baseParams = () => ({ origin: $("origin").value, trip: state.trip, direct: $("direct").checked ? "1" : "0", ...(nights() && { nights: nights() }) });

// ---------- deals ----------
let reqId = 0;
async function load() {
  const id = ++reqId;
  renderWhen();
  $("grid").innerHTML = `<li class="loading">Searching ${$("origin").value === "ALL" ? "all Philippine airports" : $("origin").selectedOptions[0].textContent}, departing ${rangeLabel()}…</li>` + '<li class="skeleton"></li>'.repeat(8);
  $("empty").hidden = true;
  const r = range();
  const p = new URLSearchParams({ ...baseParams(), ...(r && { from: r.from, to: r.to }), ...(r && r.returnBy && { returnBy: r.returnBy }) });
  try {
    const data = await fetch(API + "/api/deals?" + p).then((res) => res.json());
    if (id !== reqId) return;
    state.deals = data.deals || [];
    state.demo = !!data.demo;
    const notice = data.error || (data.demo ? "Showing sample fares for preview. Add a Travelpayouts API token on the server to see live prices." : "");
    $("notice").textContent = notice;
    $("notice").hidden = !notice;
    state.updatedAt = data.updatedAt;
  } catch {
    if (id !== reqId) return;
    state.deals = [];
    $("notice").textContent = "Couldn't reach the price server. Please try again in a moment.";
    $("notice").hidden = false;
  }
  render();
}

function render() {
  const max = Number($("budget").value);
  const anyBudget = max >= Number($("budget").max);
  $("budgetLabel").textContent = anyBudget ? "Any" : peso(max) + (adults() > 1 ? " total" : "");
  $("heroBudget").textContent = anyBudget ? "₱5,000" : peso(max);

  const q = $("q").value.trim().toLowerCase();
  const matches = (d) => !q || `${d.destinationName} ${d.countryName} ${d.destination}`.toLowerCase().includes(q);
  // A search that narrows to 1–3 destinations shows every fare to them (all dates and airports), not just the cheapest.
  const focus = q ? [...new Set(state.deals.filter(matches).map((d) => d.destination))] : [];
  const focused = focus.length > 0 && focus.length <= 3;
  if (focused) requestRoute(focus);
  const allFares = focused && state.route.key === routeParams(focus).toString() && state.route.deals;
  let deals = allFares || state.deals;
  // Otherwise, when searching all airports, keep only the cheapest way to reach each destination.
  if (!allFares && $("origin").value === "ALL") {
    const best = new Map();
    for (const d of deals) if (!best.has(d.destination) || d.price < best.get(d.destination).price) best.set(d.destination, d);
    deals = [...best.values()];
  }
  const inBudget = deals.filter((d) => (anyBudget || d.price * adults() <= max) && matches(d));

  // Region chips with counts (computed before the region filter so counts stay useful).
  const counts = { All: inBudget.length };
  for (const d of inBudget) counts[d.region] = (counts[d.region] || 0) + 1;
  if (state.region !== "All" && !counts[state.region]) counts[state.region] = 0;
  $("regions").innerHTML = ["All", ...REGION_ORDER].filter((r) => r in counts).map((r) =>
    `<button type="button" class="chip" data-r="${r}" aria-pressed="${r === state.region}">${r}<small>${counts[r]}</small></button>`).join("");

  const shown = inBudget.filter((d) => state.region === "All" || d.region === state.region);
  const sort = $("sort").value;
  shown.sort(sort === "date" ? (a, b) => a.departAt.localeCompare(b.departAt)
    : sort === "name" ? (a, b) => a.destinationName.localeCompare(b.destinationName)
    : (a, b) => a.price - b.price);

  // Split the results so the mid-page ad sits between cards. The ad container itself is never
  // re-rendered, so AdSense is asked for an ad once per page load, not on every filter change.
  const FIRST_BLOCK = 8;
  $("grid").innerHTML = shown.slice(0, FIRST_BLOCK).map((d, i) => card(d, i, !allFares)).join("");
  $("grid2").innerHTML = shown.slice(FIRST_BLOCK).map((d, i) => card(d, i + FIRST_BLOCK, !allFares)).join("");
  if ($("adMid").dataset.ready) $("adMid").hidden = shown.length <= FIRST_BLOCK;
  $("empty").hidden = shown.length > 0 || (focused && !allFares);
  if (!shown.length) renderEmpty(deals, q, anyBudget);
  const cheapest = shown.reduce((m, d) => Math.min(m, d.price), Infinity);
  const r = range();
  const names = [...new Set(shown.map((d) => d.destinationName))].join(" & ");
  renderHotels(allFares ? shown[0] : null);
  state.focusDest = allFares && shown[0] ? shown[0].destination : "";
  refreshAdsFor(state.region === "All" ? "" : state.region, state.focusDest);
  $("meta").textContent = shown.length
    ? (allFares
      ? `${shown.length} fare${shown.length === 1 ? "" : "s"} to ${names} from ${new Set(shown.map((d) => d.origin)).size} airport(s) · cheapest`
      : `${shown.length} destination${shown.length === 1 ? "" : "s"}${focused ? " · finding more dates…" : ""} · cheapest`) +
      ` ${peso(cheapest * adults())} · ${state.trip === "round" ? "round-trip" : "one-way"} fares ${adults() > 1 ? `for ${adults()} adults` : "per person"}` +
      (nights() ? ` · ${nightsLabel(nights())} stays` : "") +
      (r ? ` · departing ${rangeLabel()}` : "") +
      (r && r.returnBy ? ` · back by ${fmtRange(r.returnBy, r.returnBy)}` : "") +
      (state.updatedAt ? ` · updated ${new Date(state.updatedAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}` : "")
    : "";
  renderWhen();
  syncUrl();
}

// ---------- hotels (second affiliate stream) ----------
// Someone looking at fares to one city is also about to need a room there, so offer a hotel search
// for that city. Travelpayouts pays on hotel bookings too, using the same partner marker.
function renderHotels(deal) {
  const box = $("hotels");
  if (!deal || !CONFIG.hotelMarker) { box.hidden = true; return; }
  const url = new URL("https://search.hotellook.com/");
  url.searchParams.set("destination", `${deal.destinationName}, ${deal.countryName}`);
  url.searchParams.set("marker", CONFIG.hotelMarker);
  url.searchParams.set("currency", "php");
  url.searchParams.set("adults", adults());
  const r = range();
  if (r) { url.searchParams.set("checkIn", r.from); url.searchParams.set("checkOut", addDays(r.from, 3)); }
  box.innerHTML = `<a href="${url}" target="_blank" rel="noopener sponsored">🏨 Find hotels in ${deal.destinationName} →</a>`;
  box.hidden = false;
}

// ---------- all fares to a destination ----------
state.route = { key: "", deals: null };
let routeTimer;
function routeParams(codes) {
  const r = range();
  return new URLSearchParams({ ...baseParams(), dest: codes.join(","), ...(r && { from: r.from, to: r.to }), ...(r && r.returnBy && { returnBy: r.returnBy }) });
}
// Debounced so typing a search doesn't fire a request per keystroke; re-renders when the fares arrive.
function requestRoute(codes) {
  const key = routeParams(codes).toString();
  if (state.route.key === key) return;
  state.route = { key, deals: null };
  clearTimeout(routeTimer);
  routeTimer = setTimeout(async () => {
    try {
      const data = await fetch(API + "/api/deals?" + key).then((res) => res.json());
      if (state.route.key === key) { state.route.deals = data.deals || []; render(); }
    } catch { /* keep showing the cheapest-per-destination list */ }
  }, 250);
}

// ---------- "When do you want to fly?" ----------
const lowsCache = new Map();
async function loadLows() {
  if (state.when !== "month" && state.when !== "week") return;
  const p = new URLSearchParams({ ...baseParams(), unit: state.when });
  const key = p.toString();
  state.lowsKey = key;
  state.lows = lowsCache.get(key) || {};
  renderWhen();
  if (lowsCache.has(key)) return;
  try {
    const lows = await fetch(API + "/api/lows?" + p).then((res) => res.json());
    lowsCache.set(key, lows);
    if (state.lowsKey === key) { state.lows = lows; renderWhen(); }
  } catch { /* strip just shows no prices */ }
}

// A strip button with the cheapest known fare for that month/week.
function stripButton(value, label, selected, cheapest) {
  const low = state.lows[value];
  const isLow = low != null && low === cheapest;
  const price = low != null ? `from ${peso(low * adults())}` : lowsCache.has(state.lowsKey) ? "no fares" : "…";
  return `<button type="button" role="radio" class="mo${isLow ? " low" : ""}" data-v="${value}" aria-checked="${value === selected}">${isLow ? '<i class="badge">Cheapest</i>' : ""}<b>${label}</b><span>${price}</span></button>`;
}

// Groups buttons under a heading (year for months, month for weeks).
function renderStrip(el, keys, groupOf, labelOf, selected) {
  const known = keys.map((k) => state.lows[k]).filter((v) => v != null);
  const cheapest = known.length ? Math.min(...known) : null;
  const groups = new Map();
  for (const k of keys) {
    const g = groupOf(k);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(stripButton(k, labelOf(k), selected, cheapest));
  }
  el.innerHTML = [...groups].map(([g, items]) => `<div class="year"><span class="year-label">${g}</span><div class="year-months">${items.join("")}</div></div>`).join("");
  // Keep the chosen item in view inside the strip (scrolls the strip only, never the page).
  const btn = el.querySelector("[aria-checked=true]");
  if (!btn || el.hidden) return;
  const sr = el.getBoundingClientRect(), br = btn.getBoundingClientRect();
  if (br.left < sr.left || br.right > sr.right) el.scrollLeft += br.left - sr.left - (sr.width - br.width) / 2;
}

function renderWhen() {
  for (const b of $("when").querySelectorAll("button")) b.setAttribute("aria-checked", b.dataset.v === state.when);
  $("anyHint").hidden = state.when !== "any";
  $("monthStrip").hidden = state.when !== "month";
  $("weekStrip").hidden = state.when !== "week";
  $("custom").hidden = state.when !== "custom";

  if (state.when === "month") {
    renderStrip($("monthStrip"), MONTHS, (m) => m.slice(0, 4), (m) => short(m + "-01", { month: "short" }), state.month);
  } else if (state.when === "week") {
    renderStrip($("weekStrip"), WEEKS, (w) => short(w, { month: "short", year: "numeric" }),
      (w) => { const end = addDays(w, 6); return `${+w.slice(8)}–${end.slice(5, 7) === w.slice(5, 7) ? "" : short(end, { month: "short" }) + " "}${+end.slice(8)}`; }, state.week);
  } else if (state.when === "custom") {
    for (const id of ["dFrom", "dTo", "dReturn"]) { $(id).min = TODAY; $(id).max = HORIZON; }
    $("dTo").min = state.from || TODAY;
    $("dReturn").min = state.from || TODAY;
    $("dFrom").value = state.from;
    $("dTo").value = state.to;
    $("dReturn").value = state.returnBy;
    $("dReturnField").hidden = state.trip !== "round";
    $("presets").innerHTML = presets().map((p, i) =>
      `<button type="button" class="chip" data-i="${i}" aria-pressed="${p.from === state.from && p.to === state.to}">${p.label}</button>`).join("");
  }
}

// Handy ranges for the custom picker.
function presets() {
  const sat = addDays(TODAY, (6 - parseIso(TODAY).getDay() + 7) % 7 || 7);
  const year = +TODAY.slice(0, 4) + (TODAY.slice(5) > "12-20" ? 1 : 0);
  return [
    { label: "Next weekend", from: addDays(sat, -1), to: addDays(sat, 1) },
    { label: "Next 2 weeks", from: TODAY, to: addDays(TODAY, 13) },
    { label: "Next 30 days", from: TODAY, to: addDays(TODAY, 29) },
    { label: "Christmas break", from: `${year}-12-18`, to: `${year}-12-26` },
  ].map((p) => ({ ...p, from: p.from < TODAY ? TODAY : p.from }));
}

function setWhen(mode) {
  if (mode === state.when) return;
  state.when = mode;
  if (mode === "custom" && !state.from) { state.from = addDays(TODAY, 14); state.to = addDays(TODAY, 20); }
  loadLows();
  load();
}

// ---------- empty state ----------
// Filters that can be relaxed on the server, as changes to the /api/deals query and to the page state.
const RELAX = {
  origin: { label: "from all PH airports", active: () => $("origin").value !== "ALL", query: { origin: "ALL" }, apply: () => { $("origin").value = "ALL"; } },
  oneway: { label: "one-way", active: () => state.trip === "round", query: { trip: "oneway", nights: null, returnBy: null }, apply: () => setTrip("oneway") },
  when: { label: "any dates", active: () => state.when !== "any", query: { from: null, to: null, returnBy: null }, apply: () => { state.when = "any"; } },
  stay: { label: "any trip length", active: () => !!nights(), query: { nights: null }, apply: () => { $("stay").value = ""; setTrip(state.trip); } },
  returnBy: { label: "any return date", active: () => !!(range() && range().returnBy), query: { returnBy: null }, apply: () => { state.returnBy = ""; } },
  direct: { label: "with stopovers", active: () => $("direct").checked, query: { direct: "0" }, apply: () => { $("direct").checked = false; } },
};

function currentQuery() {
  const r = range();
  return { ...baseParams(), ...(r && { from: r.from, to: r.to }), ...(r && r.returnBy && { returnBy: r.returnBy }) };
}

let emptyReq = 0;
function renderEmpty(deals, q, anyBudget) {
  const raw = $("q").value.trim();
  const matchQ = (d) => !q || `${d.destinationName} ${d.countryName} ${d.destination}`.toLowerCase().includes(q);
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const text = q ? `No flights to “${esc(raw)}”` : "No flights";
  const from = $("origin").value === "ALL" ? "" : ` from ${$("origin").selectedOptions[0].textContent}`;
  const when = range() ? ` departing ${rangeLabel()}` : "";

  // Page-only filters (budget, region) can be checked right away.
  const fixes = [];
  const qMatches = deals.filter(matchQ);
  if (q && qMatches.length && !anyBudget) {
    fixes.push(`<button type="button" data-fix="budget">Raise budget (from ${peso(Math.min(...qMatches.map((d) => d.price)) * adults())})</button>`);
  }
  if (state.region !== "All") fixes.push('<button type="button" data-fix="region">Show all regions</button>');

  const active = Object.keys(RELAX).filter((k) => RELAX[k].active());
  const originName = $("origin").value === "ALL" ? "Manila" : $("origin").selectedOptions[0].textContent.replace(/\s*\(.*\)/, "");
  const google = q ? `<a class="google" target="_blank" rel="noopener" href="https://www.google.com/travel/flights?hl=en&curr=PHP&q=${encodeURIComponent(
    `Flights from ${originName} to ${raw}${range() ? ` on ${range().from}` : ""}${state.trip === "round" ? " round trip" : " one way"}`)}">Search “${esc(raw)}” on Google Flights →</a>` : "";
  const paint = (extra, note = "") => {
    const all = fixes.concat(extra);
    $("empty").innerHTML = `<strong>${text}${from}${when} match these filters.</strong>` +
      (note ? `<br><span class="note">${note}</span>` : "") +
      (all.length ? `<span class="fixes">${all.join("")}</span>` : "") +
      (google ? `<span class="fixes">${google}</span>` : "");
  };

  if (!q || !active.length) {
    paint([], fixes.length || google ? "" : "Try a different search.");
    return;
  }

  // With a search, ask the server which relaxed filters would actually find this place, so we only offer fixes that work.
  paint([], "Checking other options…");
  const id = ++emptyReq;
  const probe = async (keys) => {
    const query = { ...currentQuery() };
    for (const k of keys) for (const [p, v] of Object.entries(RELAX[k].query)) { if (v === null) delete query[p]; else query[p] = v; }
    const data = await fetch(API + "/api/deals?" + new URLSearchParams(query)).then((res) => res.json()).catch(() => ({ deals: [] }));
    const hits = (data.deals || []).filter(matchQ);
    return { keys, n: hits.length, low: hits.length ? Math.min(...hits.map((d) => d.price)) : 0 };
  };
  Promise.all([...active.map((k) => probe([k])), ...(active.length > 1 ? [probe(active)] : [])]).then((results) => {
    if (id !== emptyReq) return;
    const singles = results.filter((r) => r.keys.length === 1 && r.n);
    const combo = results.find((r) => r.keys.length > 1 && r.n);
    const button = (r) => `<button type="button" data-fix="${r.keys.join(",")}">Show ${r.keys.map((k) => RELAX[k].label).join(", ")} (${r.n} from ${peso(r.low * adults())})</button>`;
    const extra = singles.map(button);
    if (!singles.length && combo) extra.push(button(combo));
    paint(extra, extra.length ? "" : `We have no recent fares to “${esc(raw)}” from the Philippines. Prices here come from recent traveller searches, so rarely-searched places can be missing.`);
  });
}

$("empty").addEventListener("click", (e) => {
  const fix = e.target.closest("button")?.dataset.fix;
  if (!fix) return;
  if (fix === "budget") { $("budget").value = $("budget").max; return render(); }
  if (fix === "region") { state.region = "All"; return render(); }
  for (const k of fix.split(",")) RELAX[k]?.apply();
  loadLows();
  load();
});

// ---------- cards ----------
function bookingLink(link) {
  const n = adults();
  return link.replace("{adults}%20adults", n + (n > 1 ? "%20adults" : "%20adult")).replace("{adults}", n);
}

function card(d, i, showMore) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const band = BANDS[d.region] || "--r-other";
  const stops = d.stops === 0 ? '<span class="tag direct">Direct</span>' : `<span class="tag">${d.stops} stop${d.stops > 1 ? "s" : ""}</span>`;
  const dates = fmtDate(d.departAt) + (d.returnAt ? ` → ${fmtDate(d.returnAt)}` : "") +
    (d.nights ? ` <span class="tag stay">${d.nights} night${d.nights > 1 ? "s" : ""}</span>` : "");
  return `<li class="deal" style="--band: var(${band})">
    <div class="deal-body">
      <div class="deal-top">
        <div>
          <div class="rank">#${i + 1}</div>
          <h2 class="city">${esc(d.destinationName)}</h2>
          <div class="country">${esc(d.countryName)}</div>
        </div>
        <div class="price">${peso(d.price * adults())}${adults() > 1 ? `<span class="each">${peso(d.price)} each</span>` : ""}<small>${d.returnAt ? "round trip" : "one-way"}${adults() > 1 ? ` · ${adults()} adults` : ""}</small>${state.demo ? '<span class="sample">Sample price</span>' : ""}</div>
      </div>
      <div class="route"><span><span class="code">${esc(d.origin)}</span> → <span class="code">${esc(d.destination)}</span></span><span>${esc(d.airlineName)}</span>${stops}</div>
      <div class="dates">${dates}</div>
    </div>
    <div class="deal-actions">
      ${showMore ? `<button type="button" class="more" data-dest="${esc(d.destinationName)}">More dates</button>` : ""}
      <a href="${esc(bookingLink(d.link))}" target="_blank" rel="noopener sponsored">${state.demo ? "Check real prices →" : "See this fare →"}</a>
    </div>
  </li>`;
}

// "More dates" searches that destination, which switches the list to every fare to it.
for (const grid of [$("grid"), $("grid2")]) grid.addEventListener("click", (e) => {
  const b = e.target.closest(".more");
  if (!b) return;
  $("q").value = b.dataset.dest;
  render();
  $("meta").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------- events ----------
function setTrip(trip) {
  state.trip = trip;
  for (const x of $("trip").querySelectorAll("button")) x.setAttribute("aria-checked", x.dataset.v === trip);
  if (trip === "oneway") $("stay").value = ""; // a trip length needs a return flight
  $("nightsField").hidden = $("stay").value !== "custom";
}
setTrip(state.trip);
$("trip").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.dataset.v === state.trip) return;
  setTrip(b.dataset.v);
  loadLows();
  load();
});
// Picking a trip length switches to round trip, since one-way fares have no stay.
$("stay").addEventListener("change", () => {
  setTrip($("stay").value ? "round" : state.trip);
  loadLows();
  load();
});
["nMin", "nMax"].forEach((id) => $(id).addEventListener("change", () => { loadLows(); load(); }));
$("regions").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  state.region = b.dataset.r;
  render();
});
["origin", "direct"].forEach((id) => $(id).addEventListener("change", () => { loadLows(); load(); }));
["budget", "q"].forEach((id) => $(id).addEventListener("input", render));
$("sort").addEventListener("change", render);

$("when").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) setWhen(b.dataset.v);
});
$("monthStrip").addEventListener("click", (e) => {
  const b = e.target.closest(".mo");
  if (!b || b.dataset.v === state.month) return;
  state.month = b.dataset.v;
  load();
});
$("weekStrip").addEventListener("click", (e) => {
  const b = e.target.closest(".mo");
  if (!b || b.dataset.v === state.week) return;
  state.week = b.dataset.v;
  load();
});
// Custom dates: keep the range valid (until >= from, return >= from) and search on each committed change.
$("custom").addEventListener("change", (e) => {
  if (!isDay($("dFrom").value) || !isDay($("dTo").value)) return;
  state.from = $("dFrom").value < TODAY ? TODAY : $("dFrom").value;
  state.to = $("dTo").value;
  if (e.target.id === "dFrom" && state.to < state.from) state.to = state.from;
  if (e.target.id === "dTo" && state.to < state.from) state.from = state.to < TODAY ? TODAY : state.to;
  state.returnBy = isDay($("dReturn").value) && $("dReturn").value >= state.from ? $("dReturn").value : "";
  load();
});
$("presets").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  const p = presets()[b.dataset.i];
  state.from = p.from; state.to = p.to;
  state.returnBy = ""; // a return date picked for another range rarely makes sense for the preset
  load();
});
// Fares are per person, so changing adults only rescales prices — no refetch. Keep the budget slider's position proportional.
let prevAdults = adults();
$("adults").addEventListener("change", () => {
  const wasAny = Number($("budget").value) >= 40000 * prevAdults;
  const perPerson = Number($("budget").value) / prevAdults;
  prevAdults = adults();
  scaleBudget();
  $("budget").value = String(wasAny ? $("budget").max : perPerson * adults());
  render();
});

// ---------- installable app shell ----------
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// Chrome fires this instead of showing its own prompt; we show our button and use it on click.
let installPrompt = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("install").hidden = false;
});
$("install").addEventListener("click", async () => {
  if (!installPrompt) return;
  $("install").hidden = true;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
});
addEventListener("appinstalled", () => { $("install").hidden = true; installPrompt = null; });

const showOffline = () => { $("offline").hidden = navigator.onLine; };
addEventListener("online", () => { showOffline(); load(); });
addEventListener("offline", showOffline);
showOffline();

// ---------- ads ----------
// Your own ads come first (sold directly, no revenue share). AdSense only fills slots you
// haven't sold, and nothing at all loads if neither is set up.
const SLOTS = [["adTop", "top"], ["adMid", "mid"], ["adBottom", "bottom"]];
let adsenseLoaded = false;

function houseAd(ad) {
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const img = ad.image ? `<img src="${esc(ad.image)}" alt="">` : "";
  const style = ad.bg ? ` style="--ad-bg: ${esc(ad.bg)}"` : "";
  return `<span class="ad-label">Sponsored${ad.advertiser ? " · " + esc(ad.advertiser) : ""}</span>
    <a class="house-ad" href="${API}/go/${esc(ad.id)}" target="_blank" rel="noopener sponsored"${style}>
      ${img}
      <span class="house-text"><b>${esc(ad.headline)}</b>${ad.body ? `<span>${esc(ad.body)}</span>` : ""}</span>
      <span class="house-cta">${esc(ad.cta)} →</span>
    </a>`;
}

function adsenseSlot(box, slot) {
  const client = CONFIG.adsenseClient;
  if (!adsenseLoaded) {
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    document.head.append(script);
    adsenseLoaded = true;
  }
  box.innerHTML = `<span class="ad-label">Advertisement</span>` +
    `<ins class="adsbygoogle" style="display:block" data-ad-client="${client}" data-ad-slot="${slot}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
  (window.adsbygoogle = window.adsbygoogle || []).push({});
}

async function initAds() {
  const slotIds = { top: CONFIG.adsenseSlotTop, mid: CONFIG.adsenseSlotMid, bottom: CONFIG.adsenseSlotBottom };
  let own = {};
  try {
    const p = new URLSearchParams({
      placements: "top,mid,bottom",
      region: state.region === "All" ? "" : state.region,
      dest: state.focusDest || "",
    });
    own = await fetch(API + "/api/ads?" + p).then((res) => res.json());
  } catch { /* fall back to AdSense */ }

  for (const [id, placement] of SLOTS) {
    const box = $(id);
    if (own[placement]) box.innerHTML = houseAd(own[placement]);
    else if (CONFIG.adsenseClient && slotIds[placement]) adsenseSlot(box, slotIds[placement]);
    else { box.hidden = true; delete box.dataset.ready; continue; }
    box.dataset.ready = "1";
    box.hidden = id === "adMid" && $("grid2").children.length === 0;
  }
}

// Re-ask when the context an ad can target changes (region filter or the destination in focus),
// so a sponsor who bought "Japan" is actually shown on Japan searches.
let adsKey = "", adsTimer;
function refreshAdsFor(region, dest) {
  const key = region + "|" + dest;
  if (key === adsKey) return;
  adsKey = key;
  clearTimeout(adsTimer);
  adsTimer = setTimeout(initAds, 800);
}
initAds();

loadLows();
load();
