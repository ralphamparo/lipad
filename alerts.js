// Fare alerts: describe a trip — any city, country or region, dates, trip length, price — and
// we email when something matches. The summary line always states, in words, what will be watched.
const $ = (id) => document.getElementById(id);
const CONFIG = window.LIPAD || {};
const API = (CONFIG.apiBase || "").replace(/\/$/, "");
const peso = (n) => "₱" + Math.round(n).toLocaleString("en-PH");
const pad = (n) => String(n).padStart(2, "0");
const monthEnd = (ym) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0); return `${ym}-${pad(d.getDate())}`; };
const prettyDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" });

// A handful of country names read wrong without "the".
const THE = /^(Philippines|United States|United Kingdom|United Arab Emirates|Netherlands|Maldives|Bahamas|Czech Republic|Dominican Republic|Marshall Islands|Solomon Islands|Cook Islands|Seychelles)$/;
const theName = (n) => (THE.test(n) ? "the " + n : n);

const state = { trip: "oneway", when: "any", kind: "price", cities: [], countries: [], regions: [] };

// Months for the "a month" option.
(() => {
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    $("month").insertAdjacentHTML("beforeend", `<option value="${value}">${d.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}</option>`);
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const id of ["from", "to"]) { $(id).min = today; }
})();

// What someone typed, resolved to a city, a country, a region — or anywhere.
function resolveScope(text) {
  const q = text.trim().toLowerCase();
  if (!q) return { scope: "any", scopeValue: "", scopeLabel: "anywhere", label: "anywhere" };

  const alias = (window.LIPAD_ALIASES || {})[q];
  const byCode = state.cities.find((c) => c.code === (alias || q.toUpperCase()));
  if (byCode) return { scope: "city", scopeValue: byCode.code, scopeLabel: byCode.name, label: `${byCode.name}, ${byCode.country}`, from: byCode.from };

  const region = state.regions.find((r) => r.name.toLowerCase() === q) ||
    state.regions.find((r) => r.name.toLowerCase().startsWith(q));
  const country = state.countries.find((c) => c.name.toLowerCase() === q) ||
    state.countries.find((c) => c.name.toLowerCase().startsWith(q));
  const city = state.cities.find((c) => c.name.toLowerCase() === q || `${c.name.toLowerCase()} (${c.code.toLowerCase()})` === q) ||
    state.cities.find((c) => c.name.toLowerCase().startsWith(q));

  // Prefer the most specific thing that matches what they typed exactly.
  if (city && city.name.toLowerCase() === q) return { scope: "city", scopeValue: city.code, scopeLabel: city.name, label: `${city.name}, ${city.country}`, from: city.from };
  if (country) return { scope: "country", scopeValue: country.name, scopeLabel: country.name, label: `anywhere in ${theName(country.name)}`, from: country.from };
  if (region) return { scope: "region", scopeValue: region.name, scopeLabel: region.name, label: `anywhere in ${region.name}`, from: region.from };
  if (city) return { scope: "city", scopeValue: city.code, scopeLabel: city.name, label: `${city.name}, ${city.country}`, from: city.from };
  return null;
}

function dates() {
  if (state.when === "month") return { from: `${$("month").value}-01`, to: monthEnd($("month").value) };
  if (state.when === "range" && $("from").value && $("to").value) {
    const [a, b] = [$("from").value, $("to").value].sort();
    return { from: a, to: b };
  }
  return { from: "", to: "" };
}

function updateSummary() {
  const chosen = resolveScope($("dest").value);
  if (!chosen) {
    $("summary").textContent = `We don't have fares for "${$("dest").value.trim()}" — try a city, a country like Japan, a region like Southeast Asia, or leave it blank.`;
    return;
  }
  const d = dates();
  const bits = [`${state.trip === "round" ? "Round trips" : "One-way flights"} from ${$("origin").value === "ALL" ? "any PH airport" : $("origin").selectedOptions[0].textContent} to ${chosen.label}`];
  bits.push(d.from ? (d.from === d.to ? `departing ${prettyDay(d.from)}` : `departing ${prettyDay(d.from)} – ${prettyDay(d.to)}`) : "any time in the next 12 months");
  if (state.trip === "round" && $("stay").value) bits.push(`${$("stay").value.replace("-", "–")} night stays`);
  if ($("direct").checked) bits.push("direct only");
  bits.push(state.kind === "sale"
    ? `whenever a fare is at least ${$("discount").value}% below its usual price`
    : $("price").value ? `under ${peso($("price").value)}` : "whenever the price drops");
  $("summary").textContent = `We'll watch: ${bits.join(", ")}.`;
  if (chosen.from && !$("price").dataset.touched) $("price").placeholder = `any price — cheapest lately ${peso(chosen.from)}`;
}

async function loadPlaces() {
  try {
    const data = await fetch(`${API}/api/destinations?origin=${$("origin").value}`).then((r) => r.json());
    state.cities = data.destinations || [];
    state.countries = data.countries || [];
    state.regions = data.regions || [];
    $("destList").innerHTML = [
      ...state.regions.map((r) => `<option value="${r.name}">Region · from ${peso(r.from)}</option>`),
      ...state.countries.map((c) => `<option value="${c.name}">Country · from ${peso(c.from)}</option>`),
      ...state.cities.map((c) => `<option value="${c.name} (${c.code})">${c.country} · from ${peso(c.from)}</option>`),
    ].join("");
  } catch { /* free text still works */ }
  updateSummary();
}

// ---------- form wiring ----------
function setSeg(group, value, key) {
  state[key] = value;
  for (const b of $(group).querySelectorAll("button")) b.setAttribute("aria-checked", b.dataset.v === value);
}

$("whenMode").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  setSeg("whenMode", b.dataset.v, "when");
  $("monthField").hidden = b.dataset.v !== "month";
  $("fromField").hidden = $("toField").hidden = b.dataset.v !== "range";
  updateSummary();
});

$("trip").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  setSeg("trip", b.dataset.v, "trip");
  $("stayField").hidden = b.dataset.v !== "round";
  if (b.dataset.v === "oneway") $("stay").value = "";
  updateSummary();
});

["origin", "month", "from", "to", "stay", "direct"].forEach((id) => $(id).addEventListener("change", () => {
  if (id === "origin") loadPlaces();
  if (id === "from" && $("to").value && $("to").value < $("from").value) $("to").value = $("from").value;
  updateSummary();
}));
$("kind").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  setSeg("kind", b.dataset.v, "kind");
  $("priceField").hidden = b.dataset.v === "sale";
  $("discountField").hidden = b.dataset.v !== "sale";
  updateSummary();
});

// One tap to set up the alerts people actually ask for. A true ₱1 base fare lands around
// ₱500–1,500 once taxes are in, so the piso watch uses a realistic all-in ceiling.
const QUICK = {
  piso: { dest: "Philippines", kind: "price", price: "1499", trip: "oneway" },
  sale: { dest: "", kind: "sale", discount: "40" },
  asia: { dest: "Southeast Asia", kind: "price", price: "5000" },
};
$("quick").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  const q = QUICK[b.dataset.q];
  for (const chip of $("quick").querySelectorAll(".chip")) chip.setAttribute("aria-pressed", chip === b);
  $("dest").value = q.dest;
  $("price").value = q.price || "";
  if (q.discount) $("discount").value = q.discount;
  $("kind").querySelector(`[data-v="${q.kind}"]`).click();
  if (q.trip) $("trip").querySelector(`[data-v="${q.trip}"]`).click();
  updateSummary();
});

$("dest").addEventListener("input", updateSummary);
$("price").addEventListener("input", () => { $("price").dataset.touched = "1"; updateSummary(); });

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("msg");
  const chosen = resolveScope($("dest").value);
  if (!chosen) { msg.className = "alert-msg bad"; msg.textContent = "We don't have fares for that place — try a city, country or region."; return; }
  const d = dates();
  if (state.when === "range" && !d.from) { msg.className = "alert-msg bad"; msg.textContent = "Pick both a start and an end date."; return; }

  msg.className = "alert-msg";
  msg.textContent = "Sending…";
  try {
    const res = await fetch(`${API}/api/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: $("email").value.trim(),
        origin: $("origin").value,
        trip: state.trip,
        scope: chosen.scope,
        scopeValue: chosen.scopeValue,
        scopeLabel: chosen.scopeLabel,
        from: d.from,
        to: d.to,
        nights: state.trip === "round" ? $("stay").value : "",
        direct: $("direct").checked,
        kind: state.kind,
        minDiscount: $("discount").value,
        maxPrice: state.kind === "sale" ? "" : $("price").value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "That didn't work.");
    msg.className = "alert-msg good";
    msg.textContent = data.message;
    $("sent").hidden = false;
    $("sent").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    msg.className = "alert-msg bad";
    msg.textContent = err.message;
  }
});

// "Send it again" — the server only resends to an address with an unconfirmed alert, at most
// once every few minutes, and answers the same either way.
$("resend").addEventListener("click", async () => {
  const note = $("resendMsg");
  note.className = "alert-msg";
  note.textContent = "Sending…";
  try {
    const res = await fetch(`${API}/api/alerts/resend`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: $("email").value.trim() }),
    });
    const data = await res.json();
    note.className = "alert-msg good";
    note.textContent = data.message || "Sent.";
  } catch {
    note.className = "alert-msg bad";
    note.textContent = "Could not reach the server.";
  }
});

// Deep links: alerts.html?dest=HKG&price=4000&trip=round
const qs = new URLSearchParams(location.search);
if (qs.get("origin")) $("origin").value = qs.get("origin");
if (qs.get("price")) $("price").value = qs.get("price");
if (qs.get("trip") === "round") $("trip").querySelector('[data-v="round"]').click();

fetch(`${API}/api/alerts/status`).then((r) => r.json()).then(async (s) => {
  $("form").hidden = !s.enabled;
  $("off").hidden = s.enabled;
  if (!s.enabled) return;
  await loadPlaces();
  const pre = qs.get("dest");
  if (pre) {
    const match = state.cities.find((c) => c.code === pre.toUpperCase());
    if (match) { $("dest").value = `${match.name} (${match.code})`; updateSummary(); }
  }
}).catch(() => { $("off").hidden = false; });
