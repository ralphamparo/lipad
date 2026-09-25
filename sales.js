// Seat sales: fares priced well under what their route normally costs.
const $ = (id) => document.getElementById(id);
const CONFIG = window.LIPAD || {};
const API = (CONFIG.apiBase || "").replace(/\/$/, "");
const peso = (n) => "₱" + Math.round(n).toLocaleString("en-PH");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmtDate = (stamp) => {
  const [y, m, d] = stamp.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-PH", { weekday: "short", day: "numeric", month: "short" });
};

const state = { trip: "oneway" };

function card(d) {
  const dates = fmtDate(d.departAt) + (d.returnAt ? ` → ${fmtDate(d.returnAt)}` : "") +
    (d.nights ? ` <span class="tag stay">${d.nights} nights</span>` : "");
  const stops = d.stops === 0 ? '<span class="tag direct">Direct</span>' : `<span class="tag">${d.stops} stop${d.stops > 1 ? "s" : ""}</span>`;
  const link = d.link.replace("{adults}%20adults", "1%20adult").replace("{adults}", "1");
  return `<li class="deal sale">
    <span class="sale-flag">${d.discount}% below usual</span>
    <div class="deal-body">
      <div class="deal-top">
        <div>
          <h2 class="city">${esc(d.destinationName)}</h2>
          <div class="country">${esc(d.countryName)}</div>
        </div>
        <div class="price">${peso(d.price)}<small><s>${peso(d.typical)}</s> usually</small></div>
      </div>
      <div class="route"><span><span class="code">${esc(d.origin)}</span> → <span class="code">${esc(d.destination)}</span></span><span>${esc(d.airlineName)}</span>${stops}</div>
      <div class="dates">${dates}</div>
      <div class="saving">Save about ${peso(d.typical - d.price)}</div>
    </div>
    <div class="deal-actions">
      <a href="./?q=${encodeURIComponent(d.destinationName)}">More dates</a>
      <a href="${esc(link)}" target="_blank" rel="noopener sponsored">See this fare →</a>
    </div>
  </li>`;
}

let reqId = 0;
async function load() {
  const id = ++reqId;
  $("meta").textContent = "Finding sales…";
  $("grid").innerHTML = '<li class="skeleton"></li>'.repeat(6);
  $("empty").hidden = true;
  const p = new URLSearchParams({ origin: $("origin").value, trip: state.trip, direct: $("direct").checked ? "1" : "0" });
  try {
    const data = await fetch(`${API}/api/sales?${p}`).then((r) => r.json());
    if (id !== reqId) return;
    const deals = data.deals || [];
    $("grid").innerHTML = deals.map(card).join("");
    $("empty").hidden = deals.length > 0;
    $("empty").textContent = "No route is unusually cheap right now. Try another airport, or check the main deals page.";
    $("meta").textContent = deals.length
      ? `${deals.length} route${deals.length === 1 ? "" : "s"} below their usual price · biggest drop ${deals[0].discount}% · ${state.trip === "round" ? "round-trip" : "one-way"} fares` +
        (data.updatedAt ? ` · updated ${new Date(data.updatedAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}` : "")
      : "";
  } catch {
    if (id !== reqId) return;
    $("grid").innerHTML = "";
    $("meta").textContent = "Couldn't reach the price server. Please try again in a moment.";
  }
}

$("trip").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.dataset.v === state.trip) return;
  state.trip = b.dataset.v;
  for (const x of $("trip").querySelectorAll("button")) x.setAttribute("aria-checked", x === b);
  load();
});
["origin", "direct"].forEach((id) => $(id).addEventListener("change", load));

load();
