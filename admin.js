// Ad manager: create, edit and retire your own sponsors, and see how they perform.
const $ = (id) => document.getElementById(id);
const API = ((window.LIPAD || {}).apiBase || "").replace(/\/$/, "");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The password stays in this browser only; it is sent as a bearer token on each request.
let pass = sessionStorage.getItem("lipadAdmin") || "";

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + pass, ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function show(signedIn) {
  $("login").hidden = signedIn;
  $("panel").hidden = !signedIn;
  $("logout").hidden = !signedIn;
}

$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  pass = $("pass").value;
  try {
    await refresh();
    sessionStorage.setItem("lipadAdmin", pass);
    show(true);
  } catch (err) {
    $("loginHint").textContent = err.message;
  }
});

$("logout").addEventListener("click", () => {
  sessionStorage.removeItem("lipadAdmin");
  pass = "";
  show(false);
});

async function refresh() {
  const { ads } = await api("/api/admin/ads");
  const totals = ads.reduce((t, a) => ({ i: t.i + a.impressions, c: t.c + a.clicks }), { i: 0, c: 0 });
  $("stats").textContent = ads.length
    ? `${ads.length} sponsor${ads.length === 1 ? "" : "s"} · ${totals.i.toLocaleString()} views · ${totals.c.toLocaleString()} clicks · ${totals.i ? (100 * totals.c / totals.i).toFixed(2) : "0.00"}% click rate`
    : "No sponsors yet. Add your first one below.";
  $("table").innerHTML = ads.length ? `
    <tr><th>Sponsor</th><th>Where</th><th>Targeting</th><th>Runs</th><th>Views</th><th>Clicks</th><th>CTR</th><th></th></tr>
    ${ads.map((a) => `<tr class="${a.active ? "" : "off"}">
      <td><b>${esc(a.headline)}</b><br><small>${esc(a.advertiser || "—")}</small></td>
      <td>${a.placements.join(", ")}</td>
      <td>${esc([...(a.regions || []), ...(a.destinations || [])].join(", ") || "everywhere")}</td>
      <td>${esc(a.start || "now")} → ${esc(a.end || "no end")}</td>
      <td>${a.impressions.toLocaleString()}</td>
      <td>${a.clicks.toLocaleString()}</td>
      <td>${a.ctr}%</td>
      <td class="row-actions">
        <button type="button" class="chip" data-edit="${a.id}">Edit</button>
        <button type="button" class="chip" data-toggle="${a.id}">${a.active ? "Pause" : "Resume"}</button>
        <button type="button" class="chip" data-del="${a.id}">Delete</button>
      </td>
    </tr>`).join("")}` : "";
  window.currentAds = ads;
}

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error("Could not read that image."));
  r.readAsDataURL(file);
});

$("adForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const list = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
  const payload = {
    id: $("adId").value || undefined,
    advertiser: $("advertiser").value,
    headline: $("headline").value,
    body: $("body").value,
    cta: $("cta").value,
    url: $("url").value,
    bg: $("bg").value === "#ffffff" ? "" : $("bg").value,
    placements: [...document.querySelectorAll('input[name=placement]:checked')].map((c) => c.value),
    regions: list($("regions").value),
    destinations: list($("destinations").value),
    start: $("start").value,
    end: $("end").value,
    weight: $("weight").value,
    active: $("active").checked,
  };
  const file = $("image").files[0];
  if (file) payload.image = await fileToDataUrl(file);
  $("formMsg").textContent = "Saving…";
  try {
    await api("/api/admin/ads", { method: "POST", body: JSON.stringify(payload) });
    $("formMsg").textContent = "Saved.";
    resetForm();
    await refresh();
  } catch (err) {
    $("formMsg").textContent = err.message;
  }
});

function resetForm() {
  $("adForm").reset();
  $("adId").value = "";
  $("formTitle").textContent = "Add a sponsor";
  $("cancel").hidden = true;
}
$("cancel").addEventListener("click", resetForm);

$("table").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const { edit, del, toggle } = btn.dataset;
  const ad = (window.currentAds || []).find((a) => a.id === (edit || del || toggle));
  if (!ad) return;
  try {
    if (edit) {
      $("adId").value = ad.id;
      $("advertiser").value = ad.advertiser;
      $("headline").value = ad.headline;
      $("body").value = ad.body;
      $("cta").value = ad.cta;
      $("url").value = ad.url;
      $("bg").value = ad.bg || "#ffffff";
      $("regions").value = (ad.regions || []).join(", ");
      $("destinations").value = (ad.destinations || []).join(", ");
      $("start").value = ad.start;
      $("end").value = ad.end;
      $("weight").value = ad.weight;
      $("active").checked = ad.active;
      for (const c of document.querySelectorAll("input[name=placement]")) c.checked = ad.placements.includes(c.value);
      $("formTitle").textContent = "Edit sponsor";
      $("cancel").hidden = false;
      $("formTitle").scrollIntoView({ behavior: "smooth" });
    } else if (toggle) {
      await api("/api/admin/ads", { method: "POST", body: JSON.stringify({ ...ad, active: !ad.active, image: undefined }) });
      await refresh();
    } else if (del && confirm(`Delete “${ad.headline}”? Its view and click counts go too.`)) {
      await api("/api/admin/ads/" + ad.id, { method: "DELETE" });
      await refresh();
    }
  } catch (err) {
    $("stats").textContent = err.message;
  }
});

// Already signed in this tab? Go straight to the panel.
if (pass) refresh().then(() => show(true)).catch(() => show(false));
