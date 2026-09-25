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

const state = { kind: "all", fares: {}, sales: {}, loading: true };

function render() {
  const counts = { all: 0 };
  const rows = VISA.countries.map((c) => ({ ...c, fare: state.fares[c.code] || null, sale: state.sales[c.code] || null }));
  for (const r of rows) { counts.all++; counts[r.kind] = (counts[r.kind] || 0) + 1; }

  $("kinds").innerHTML = [["all", "All"], ...Object.entries(KINDS).map(([k, v]) => [k, v.label])]
    .map(([k, label]) => `<button type="button" class="chip" data-k="${k}" aria-pressed="${k === state.kind}">${label}<small>${counts[k] || 0}</small></button>`)
    .join("");

  let shown = rows.filter((r) => state.kind === "all" || r.kind === state.kind);
  if ($("onSale").checked) shown = shown.filter((r) => r.sale);
  else if ($("withFares").checked) shown = shown.filter((r) => r.fare);
  // On sale first (biggest drop leads), then cheapest; places with no fare go last, alphabetically.
  shown.sort((a, b) =>
    (b.sale ? b.sale.discount : 0) - (a.sale ? a.sale.discount : 0) ||
    (a.fare && b.fare ? a.fare.price - b.fare.price : a.fare ? -1 : b.fare ? 1 : a.name.localeCompare(b.name)));

  $("grid").innerHTML = shown.map((r) => {
    const k = KINDS[r.kind];
    const stay = r.days ? `Stay up to ${r.days} days` : "Length of stay varies";
    const fare = r.sale
      ? `<div class="price">${peso(r.sale.price)}<small><s>${peso(r.sale.typical)}</s> from ${esc(r.sale.origin)}</small></div>`
      : r.fare
        ? `<div class="price">${peso(r.fare.price)}<small>one-way from ${esc(r.fare.origin)}</small></div>`
        : `<div class="price none">—<small>no fare found</small></div>`;
    const flag = r.sale ? `<span class="sale-flag">🔥 ${r.sale.discount}% off</span>` : "";
    const link = r.fare
      ? `<a href="./?q=${encodeURIComponent(r.name)}">See flights to ${esc(r.name)} →</a>`
      : `<a href="./?q=${encodeURIComponent(r.name)}">Search ${esc(r.name)} →</a>`;
    return `<li class="deal visa${r.sale ? " sale" : ""}" style="--band: var(--r-${r.kind === "free" ? "sea" : r.kind === "arrival" ? "oc" : r.kind === "online" ? "ea" : "other"})">
      ${flag}
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
  const onSaleCount = shown.filter((r) => r.sale).length;
  $("meta").textContent = state.loading
    ? "Loading fares…"
    : `${shown.length} destination${shown.length === 1 ? "" : "s"} · ${withFare} with a fare right now` + (onSaleCount ? ` · ${onSaleCount} on sale 🔥` : "") +
      (withFare ? ` · cheapest ${peso(Math.min(...shown.filter((r) => r.fare).map((r) => r.fare.price)))}` : "");
  $("stamp").textContent = `Visa information last reviewed ${new Date(VISA.reviewed).toLocaleDateString("en-PH", { day: "numeric", month: "long", year: "numeric" })}.`;
}

async function loadFares() {
  state.loading = true;
  render();
  const origin = $("origin").value;
  const get = (path) => fetch(`${API}${path}`).then((r) => r.json()).catch(() => ({ deals: [] }));
  const [deals, sales] = await Promise.all([
    get(`/api/deals?origin=${origin}&trip=oneway`),
    get(`/api/sales?origin=${origin}&trip=oneway`),
  ]);
  // Cheapest fare per country, not per city.
  const best = {};
  for (const d of deals.deals || []) {
    if (!best[d.country] || d.price < best[d.country].price) best[d.country] = d;
  }
  // Biggest drop per country, so a visa-free place on sale stands out.
  const hot = {};
  for (const d of sales.deals || []) {
    if (!hot[d.country] || d.discount > hot[d.country].discount) hot[d.country] = d;
  }
  state.fares = best;
  state.sales = hot;
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
$("onSale").addEventListener("change", render);
$("origin").addEventListener("change", loadFares);

loadFares();
