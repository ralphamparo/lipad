// Fare alerts for any destination: pick a place (or leave it blank for anywhere) and a price.
const $ = (id) => document.getElementById(id);
const CONFIG = window.LIPAD || {};
const API = (CONFIG.apiBase || "").replace(/\/$/, "");
const peso = (n) => "₱" + Math.round(n).toLocaleString("en-PH");

const state = { trip: "oneway", destinations: [] };

// A typed destination matches on city name, country or airport code — "tokyo", "japan" and "TYO" all work.
function resolveDest(text) {
  const q = text.trim().toLowerCase();
  if (!q) return { code: "", label: "anywhere" };
  const list = state.destinations;
  const alias = (window.LIPAD_ALIASES || {})[q];
  if (alias) {
    const byCode = list.find((d) => d.code === alias);
    if (byCode) return { code: byCode.code, label: `${byCode.name}, ${byCode.country}`, from: byCode.from };
  }
  const exact = list.find((d) => d.code.toLowerCase() === q || d.name.toLowerCase() === q ||
    `${d.name.toLowerCase()} (${d.code.toLowerCase()})` === q);
  const partial = exact || list.find((d) => d.name.toLowerCase().startsWith(q)) ||
    list.find((d) => `${d.name} ${d.country}`.toLowerCase().includes(q));
  return partial ? { code: partial.code, label: `${partial.name}, ${partial.country}`, from: partial.from } : null;
}

function updateHint() {
  const chosen = resolveDest($("dest").value);
  if (!chosen) { $("hint").textContent = `We don't have fares for "${$("dest").value.trim()}" yet — try another spelling, or leave it blank for anywhere.`; return; }
  const from = $("origin").value === "ALL" ? "any PH airport" : $("origin").selectedOptions[0].textContent;
  const seen = chosen.from ? ` The cheapest we've seen lately is ${peso(chosen.from)}.` : "";
  $("hint").textContent = `Watching ${state.trip === "round" ? "round-trip" : "one-way"} fares from ${from} to ${chosen.label}.${seen}`;
  if (chosen.from && !$("price").value) $("price").value = Math.max(500, Math.floor(chosen.from * 0.9 / 100) * 100);
}

async function loadDestinations() {
  try {
    const data = await fetch(`${API}/api/destinations?origin=${$("origin").value}`).then((r) => r.json());
    state.destinations = data.destinations || [];
    $("destList").innerHTML = state.destinations
      .map((d) => `<option value="${d.name} (${d.code})">${d.country} · from ${peso(d.from)}</option>`).join("");
    updateHint();
  } catch { /* the picker still accepts free text */ }
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("msg");
  const chosen = resolveDest($("dest").value);
  if (!chosen) { msg.className = "alert-msg bad"; msg.textContent = "Pick a destination from the list, or leave it blank for anywhere."; return; }
  msg.className = "alert-msg";
  msg.textContent = "Sending…";
  try {
    const res = await fetch(`${API}/api/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: $("email").value.trim(),
        origin: $("origin").value,
        dest: chosen.code,
        trip: state.trip,
        maxPrice: $("price").value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "That didn't work.");
    msg.className = "alert-msg good";
    msg.textContent = data.message;
    $("form").reset();
    updateHint();
  } catch (err) {
    msg.className = "alert-msg bad";
    msg.textContent = err.message;
  }
});

$("trip").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.dataset.v === state.trip) return;
  state.trip = b.dataset.v;
  for (const x of $("trip").querySelectorAll("button")) x.setAttribute("aria-checked", x === b);
  updateHint();
});
$("origin").addEventListener("change", () => { loadDestinations(); updateHint(); });
$("dest").addEventListener("input", updateHint);

// Prefill from a link like alerts.html?dest=HKG&price=4000, so cards elsewhere can deep-link here.
const qs = new URLSearchParams(location.search);
if (qs.get("origin")) $("origin").value = qs.get("origin");
if (qs.get("price")) $("price").value = qs.get("price");
if (qs.get("trip") === "round") $("trip").querySelector('[data-v="round"]').click();

fetch(`${API}/api/alerts/status`).then((r) => r.json()).then(async (s) => {
  $("form").hidden = !s.enabled;
  $("off").hidden = s.enabled;
  if (!s.enabled) return;
  await loadDestinations();
  const pre = qs.get("dest");
  if (pre) {
    const match = state.destinations.find((d) => d.code === pre.toUpperCase());
    if (match) { $("dest").value = `${match.name} (${match.code})`; updateHint(); }
  }
}).catch(() => { $("off").hidden = false; });
