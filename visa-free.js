// Joins the visa list to live fares: for each country, the cheapest flight there right now.
const $ = (id) => document.getElementById(id);
const CONFIG = window.LIPAD || {};
const API = (CONFIG.apiBase || "").replace(/\/$/, "");
const VISA = window.LIPAD_VISA;
const peso = (n) => "₱" + Math.round(n).toLocaleString("en-PH");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const KINDS = {
  free: { label: "Visa-free", blurb: "Just show up with your passport." },
  arrival: { label: "Visa on arrival", blurb: "Issued at the border, usually for a fee." },
  online: { label: "eTA / eVisa", blurb: "Apply online before you fly." },
  conditional: { label: "Conditional", blurb: "Only if you hold another country's visa." },
};

const state = { kind: "all", fares: {}, loading: true };

function render() {
  const counts = { all: 0 };
  const rows = VISA.countries.map((c) => ({ ...c, fare: state.fares[c.code] || null }));
  for (const r of rows) { counts.all++; counts[r.kind] = (counts[r.kind] || 0) + 1; }

  $("kinds").innerHTML = [["all", "All"], ...Object.entries(KINDS).map(([k, v]) => [k, v.label])]
    .map(([k, label]) => `<button type="button" class="chip" data-k="${k}" aria-pressed="${k === state.kind}">${label}<small>${counts[k] || 0}</small></button>`)
    .join("");

  let shown = rows.filter((r) => state.kind === "all" || r.kind === state.kind);
  if ($("withFares").checked) shown = shown.filter((r) => r.fare);
  // Cheapest first; places we have no fare for go last, alphabetically.
  shown.sort((a, b) => (a.fare && b.fare ? a.fare.price - b.fare.price : a.fare ? -1 : b.fare ? 1 : a.name.localeCompare(b.name)));

  $("grid").innerHTML = shown.map((r) => {
    const k = KINDS[r.kind];
    const stay = r.days ? `Stay up to ${r.days} days` : "Length of stay varies";
    const fare = r.fare
      ? `<div class="price">${peso(r.fare.price)}<small>one-way from ${esc(r.fare.origin)}</small></div>`
      : `<div class="price none">—<small>no fare found</small></div>`;
    const link = r.fare
      ? `<a href="./?q=${encodeURIComponent(r.name)}">See flights to ${esc(r.name)} →</a>`
      : `<a href="./?q=${encodeURIComponent(r.name)}">Search ${esc(r.name)} →</a>`;
    return `<li class="deal visa" style="--band: var(--r-${r.kind === "free" ? "sea" : r.kind === "arrival" ? "oc" : r.kind === "online" ? "ea" : "other"})">
      <div class="deal-body">
        <div class="deal-top">
          <div>
            <h2 class="city">${esc(r.name)}</h2>
            <div class="country">${stay}</div>
          </div>
          ${fare}
        </div>
        <div class="route"><span class="tag ${r.kind === "free" ? "direct" : ""}">${k.label}</span><span>${esc(r.note || k.blurb)}</span></div>
      </div>
      <div class="deal-actions">${link}</div>
    </li>`;
  }).join("");

  const withFare = shown.filter((r) => r.fare).length;
  $("meta").textContent = state.loading
    ? "Loading fares…"
    : `${shown.length} destination${shown.length === 1 ? "" : "s"} · ${withFare} with a fare right now` +
      (withFare ? ` · cheapest ${peso(Math.min(...shown.filter((r) => r.fare).map((r) => r.fare.price)))}` : "");
  $("stamp").textContent = `Visa information last reviewed ${new Date(VISA.reviewed).toLocaleDateString("en-PH", { day: "numeric", month: "long", year: "numeric" })}.`;
}

async function loadFares() {
  state.loading = true;
  render();
  try {
    const data = await fetch(`${API}/api/deals?origin=${$("origin").value}&trip=oneway`).then((r) => r.json());
    // Cheapest fare per country, not per city.
    const best = {};
    for (const d of data.deals || []) {
      if (!best[d.country] || d.price < best[d.country].price) best[d.country] = d;
    }
    state.fares = best;
  } catch {
    state.fares = {};
  }
  state.loading = false;
  render();
}

$("kinds").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  state.kind = b.dataset.k;
  render();
});
$("withFares").addEventListener("change", render);
$("origin").addEventListener("change", loadFares);

loadFares();
