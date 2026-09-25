// Lipad's own ad system: store, target, serve and count ads you sell directly.
// No third party involved — creatives live in uploads/, the rest in data/ads.json.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const FILE = path.join(DATA_DIR, "ads.json");
const PLACEMENTS = ["top", "mid", "bottom"];
const MAX_IMAGE_BYTES = 600 * 1024;

let ads = [];
let dirty = false;

function load() {
  try {
    ads = JSON.parse(fs.readFileSync(FILE, "utf8")).ads || [];
  } catch {
    ads = []; // no file yet
  }
}
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ ads }, null, 2));
  fs.renameSync(tmp, FILE); // atomic, so a crash mid-write can't corrupt the file
  dirty = false;
}
// Impression counts change constantly; write them out on a timer instead of on every view.
setInterval(() => { if (dirty) save(); }, 15000).unref();
process.on("exit", () => { if (dirty) save(); });
load();

const today = () => new Date().toISOString().slice(0, 10);
const clean = (s, max = 200) => String(s == null ? "" : s).slice(0, max).trim();

function eligible(ad, { placement, region, dest }) {
  if (!ad.active) return false;
  if (!ad.placements.includes(placement)) return false;
  const d = today();
  if (ad.start && d < ad.start) return false;
  if (ad.end && d > ad.end) return false;
  if (ad.regions.length && !ad.regions.includes(region)) return false;
  if (ad.destinations.length && !(dest && ad.destinations.includes(dest))) return false;
  return true;
}

// Picks one ad per placement, weighted, and counts the impression.
function serve({ placements, region, dest }) {
  const out = {};
  for (const placement of placements) {
    const pool = ads.filter((a) => eligible(a, { placement, region, dest }));
    if (!pool.length) continue;
    const total = pool.reduce((n, a) => n + Math.max(1, a.weight), 0);
    let r = Math.random() * total;
    const pick = pool.find((a) => (r -= Math.max(1, a.weight)) <= 0) || pool[0];
    pick.impressions = (pick.impressions || 0) + 1;
    dirty = true;
    out[placement] = {
      id: pick.id, advertiser: pick.advertiser, headline: pick.headline, body: pick.body,
      cta: pick.cta, image: pick.image, bg: pick.bg,
    };
  }
  return out;
}

function click(id) {
  const ad = ads.find((a) => a.id === id);
  if (!ad) return null;
  ad.clicks = (ad.clicks || 0) + 1;
  dirty = true;
  return ad.url;
}

// data:image/png;base64,... -> a file in uploads/, returned as a site-relative path.
function saveImage(dataUrl, id) {
  const m = /^data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl || "");
  if (!m) throw new Error("Image must be a PNG, JPEG, GIF or WebP file.");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("Image is larger than 600 KB — please shrink it.");
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  // One file per ad: replacing the creative overwrites it and leaves nothing orphaned.
  for (const old of fs.readdirSync(UPLOADS_DIR)) if (old.startsWith(id + ".")) fs.rmSync(path.join(UPLOADS_DIR, old));
  fs.writeFileSync(path.join(UPLOADS_DIR, `${id}.${ext}`), buf);
  return `uploads/${id}.${ext}`;
}

function upsert(input) {
  const existing = input.id ? ads.find((a) => a.id === input.id) : null;
  const id = existing ? existing.id : crypto.randomBytes(6).toString("hex");
  const url = clean(input.url, 2000);
  if (!/^https?:\/\//i.test(url)) throw new Error("Link must start with http:// or https://");
  const headline = clean(input.headline, 80);
  if (!headline) throw new Error("Headline is required.");

  const ad = {
    id,
    advertiser: clean(input.advertiser, 80),
    headline,
    body: clean(input.body, 160),
    cta: clean(input.cta, 30) || "Learn more",
    url,
    bg: /^#[0-9a-f]{6}$/i.test(input.bg || "") ? input.bg : "",
    image: existing ? existing.image : "",
    placements: (Array.isArray(input.placements) ? input.placements : []).filter((p) => PLACEMENTS.includes(p)),
    regions: (Array.isArray(input.regions) ? input.regions : []).map((r) => clean(r, 40)).filter(Boolean),
    destinations: (Array.isArray(input.destinations) ? input.destinations : [])
      .map((d) => clean(d, 3).toUpperCase()).filter((d) => /^[A-Z]{3}$/.test(d)),
    start: /^\d{4}-\d{2}-\d{2}$/.test(input.start || "") ? input.start : "",
    end: /^\d{4}-\d{2}-\d{2}$/.test(input.end || "") ? input.end : "",
    weight: Math.min(100, Math.max(1, Math.round(Number(input.weight) || 1))),
    active: input.active !== false,
    impressions: existing ? existing.impressions || 0 : 0,
    clicks: existing ? existing.clicks || 0 : 0,
    created: existing ? existing.created : new Date().toISOString(),
  };
  if (!ad.placements.length) ad.placements = ["mid"];
  if (input.image === null) ad.image = ""; // explicit removal
  else if (typeof input.image === "string" && input.image.startsWith("data:")) ad.image = saveImage(input.image, id);

  if (existing) ads[ads.indexOf(existing)] = ad;
  else ads.push(ad);
  save();
  return ad;
}

function remove(id) {
  const i = ads.findIndex((a) => a.id === id);
  if (i < 0) return false;
  ads.splice(i, 1);
  save();
  try {
    for (const f of fs.readdirSync(UPLOADS_DIR)) if (f.startsWith(id + ".")) fs.rmSync(path.join(UPLOADS_DIR, f));
  } catch { /* no uploads yet */ }
  return true;
}

const list = () => ads.map((a) => ({ ...a, ctr: a.impressions ? +(100 * a.clicks / a.impressions).toFixed(2) : 0 }));

module.exports = { PLACEMENTS, serve, click, upsert, remove, list };
