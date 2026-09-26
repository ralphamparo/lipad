// Fare alerts: someone describes a trip they'd like, and we email them when a matching fare shows up.
// Double opt-in (nobody gets mail they didn't confirm), one-click unsubscribe, and a cap per
// address so the list can't be used to spam someone.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "alerts.json");
const MAX_PER_EMAIL = 8;
const RESEND_KEY = process.env.RESEND_API_KEY || "";
const FROM = process.env.ALERT_FROM || "Lipad <onboarding@resend.dev>";
const SITE = (process.env.SITE_URL || "").replace(/\/$/, "");
const CHECK_MS = 6 * 60 * 60 * 1000;
const QUIET_MS = 3 * 24 * 60 * 60 * 1000; // don't email the same alert more than every 3 days

const enabled = () => Boolean(RESEND_KEY && SITE);

let alerts = [];
try { alerts = JSON.parse(fs.readFileSync(FILE, "utf8")).alerts || []; } catch { alerts = []; }
// Alerts saved before destinations could be a country or region only had a `dest` airport code.
// Without this they would sit in the file matching nothing, silently.
for (const a of alerts) {
  if (a.scope) continue;
  a.scope = a.dest ? "city" : "any";
  a.scopeValue = a.dest || "";
  a.scopeLabel = a.dest || "anywhere";
  a.from = a.from || "";
  a.to = a.to || "";
  a.direct = a.direct || false;
  a.minNights = a.minNights || 0;
  a.maxNights = a.maxNights || 0;
  delete a.dest;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ alerts }, null, 2));
  fs.renameSync(tmp, FILE);
}

const peso = (n) => "₱" + Math.round(n).toLocaleString("en-PH");
const token = () => crypto.randomBytes(16).toString("hex");
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e || "");
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
const day = (stamp) => stamp.slice(0, 10);
const pretty = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// ---------- describing an alert in plain words ----------
function whereLabel(a) {
  if (a.scope === "city") return a.scopeLabel || a.scopeValue;
  if (a.scope === "country") return a.scopeLabel || a.scopeValue;
  if (a.scope === "region") return a.scopeValue;
  return "anywhere";
}

function describe(a) {
  const bits = [];
  bits.push(`${a.trip === "round" ? "Round trips" : "One-way flights"} from ${a.origin === "ALL" ? "any PH airport" : a.origin} to ${whereLabel(a)}`);
  if (a.from && a.to) bits.push(a.from === a.to ? `departing ${pretty(a.from)}` : `departing between ${pretty(a.from)} and ${pretty(a.to)}`);
  else bits.push("any dates in the next 12 months");
  if (a.minNights) bits.push(`${a.minNights}–${a.maxNights} night stays`);
  if (a.direct) bits.push("direct flights only");
  bits.push(a.maxPrice ? `under ${peso(a.maxPrice)}` : "whenever the price drops");
  return bits.join(", ");
}

async function sendEmail({ to, subject, text, html }) {
  if (!RESEND_KEY) throw new Error("Email is not configured on this server.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
  });
  if (!res.ok) throw new Error(`Email service said ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const shell = (body) => `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:560px;color:#1b1f2a">
  <p style="font-size:20px;font-weight:800;color:#0b3d91;margin:0 0 16px">✈ Lipad</p>${body}
  <p style="color:#667085;font-size:12px;margin-top:24px">Fares come from recent traveller searches and can change before you book.</p></div>`;

// ---------- signing up ----------
async function subscribe(input) {
  if (!enabled()) throw new Error("Fare alerts aren't switched on for this site yet.");
  const email = String(input.email || "").trim().toLowerCase();
  if (!validEmail(email)) throw new Error("That email address doesn't look right.");
  if (alerts.filter((a) => a.email === email).length >= MAX_PER_EMAIL) {
    throw new Error(`That address already has ${MAX_PER_EMAIL} alerts — remove one from an alert email first.`);
  }

  const scope = ["city", "country", "region", "any"].includes(input.scope) ? input.scope : "any";
  const scopeValue = String(input.scopeValue || "").slice(0, 60).trim();
  if (scope !== "any" && !scopeValue) throw new Error("Pick a destination, or choose anywhere.");
  if (scope === "city" && !/^[A-Z]{3}$/.test(scopeValue)) throw new Error("That city isn't one we have fares for.");

  const price = input.maxPrice === "" || input.maxPrice == null ? 0 : Math.round(Number(input.maxPrice));
  if (price && (price < 500 || price > 500000)) throw new Error("Pick a target price between ₱500 and ₱500,000.");

  let from = isDay(input.from) ? input.from : "";
  let to = isDay(input.to) ? input.to : "";
  if (from && to && from > to) [from, to] = [to, from];
  if (Boolean(from) !== Boolean(to)) throw new Error("Give both a start and an end date, or leave both blank.");

  const nights = /^(\d{1,2})-(\d{1,2})$/.exec(input.nights || "");
  const alert = {
    id: token(),
    email,
    origin: /^[A-Z]{3}$/.test(input.origin || "") ? input.origin : "ALL",
    trip: input.trip === "round" ? "round" : "oneway",
    scope,
    scopeValue,
    scopeLabel: String(input.scopeLabel || scopeValue).slice(0, 80),
    from,
    to,
    direct: input.direct === true,
    minNights: nights ? Math.min(+nights[1], +nights[2]) : 0,
    maxNights: nights ? Math.max(+nights[1], +nights[2]) : 0,
    maxPrice: price,
    confirmed: false,
    created: new Date().toISOString(),
    lastSent: 0,
    lastPrice: 0,
  };
  if (alert.trip === "oneway") { alert.minNights = 0; alert.maxNights = 0; }

  alerts.push(alert);
  save();

  const link = `${SITE}/alerts/confirm?t=${alert.id}`;
  await sendEmail({
    to: alert.email,
    subject: "Confirm your Lipad fare alert",
    text: `Confirm this alert to start receiving deals:\n${describe(alert)}\n\n${link}\n\nIf you didn't ask for this, ignore this email and nothing will be sent.`,
    html: shell(`<p>One click and we'll start watching for this trip:</p>
      <p style="background:#f6f3ee;border-radius:10px;padding:12px 14px"><b>${describe(alert)}</b></p>
      <p><a href="${link}" style="background:#0b3d91;color:#fff;text-decoration:none;padding:11px 20px;border-radius:999px;display:inline-block;font-weight:600">Confirm this alert</a></p>
      <p style="color:#667085;font-size:13px">If you didn't ask for this, ignore this email — nothing more will be sent.</p>`),
  });
  return { ok: true };
}

// Confirming turns the alert on and tells them what they'll receive.
async function confirm(id) {
  const a = alerts.find((x) => x.id === id);
  if (!a) return null;
  const wasNew = !a.confirmed;
  a.confirmed = true;
  save();
  if (wasNew) {
    try {
      await sendEmail({
        to: a.email,
        subject: "You're all set — we're watching for your trip",
        text: `Your alert is live:\n${describe(a)}\n\nWe check prices through the day and will email you when a matching fare appears. Stop anytime: ${SITE}/alerts/unsubscribe?t=${a.id}`,
        html: shell(`<p><b>Your alert is live.</b> We check prices through the day and will email you as soon as a matching fare appears.</p>
          <p style="background:#f6f3ee;border-radius:10px;padding:12px 14px">${describe(a)}</p>
          <p>In the meantime, <a href="${SITE}/">see what's cheap right now</a>.</p>
          <p style="color:#667085;font-size:13px"><a href="${SITE}/alerts/unsubscribe?t=${a.id}">Stop this alert</a> at any time.</p>`),
      });
    } catch (e) {
      console.error("welcome email failed:", e.message);
    }
  }
  return a;
}

function unsubscribe(id) {
  const i = alerts.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const [a] = alerts.splice(i, 1);
  save();
  return a;
}

// ---------- checking prices ----------
const matchesScope = (d, a) =>
  a.scope === "any" ||
  (a.scope === "city" && d.destination === a.scopeValue) ||
  (a.scope === "country" && (d.country === a.scopeValue || d.countryName === a.scopeValue)) ||
  (a.scope === "region" && d.region === a.scopeValue);

// getDeals is injected so this file doesn't reach into the fare cache itself.
async function check(getDeals) {
  if (!enabled()) return { checked: 0, sent: 0 };
  const now = Date.now();
  let sent = 0;
  const due = alerts.filter((a) => a.confirmed && now - a.lastSent > QUIET_MS);

  for (const a of due) {
    try {
      const { deals } = await getDeals({
        origin: a.origin,
        oneWay: a.trip === "oneway",
        direct: a.direct,
        from: a.from, to: a.to, returnBy: "",
        minNights: a.minNights, maxNights: a.maxNights,
        dest: a.scope === "city" ? [a.scopeValue] : [],
      });
      const matching = (deals || []).filter((d) => matchesScope(d, a)).sort((x, y) => x.price - y.price);
      const hit = matching[0];
      if (!hit) continue;
      // With a target price: anything under it. Without one: only a genuine drop on what we last sent.
      const worth = a.maxPrice ? hit.price <= a.maxPrice : true;
      if (!worth || (a.lastPrice && hit.price >= a.lastPrice)) continue;

      const link = hit.link.replace("{adults}%20adults", "1%20adult").replace("{adults}", "1");
      const stop = `${SITE}/alerts/unsubscribe?t=${a.id}`;
      const others = matching.slice(1, 4);
      const when = `${pretty(day(hit.departAt))}${hit.returnAt ? ` → ${pretty(day(hit.returnAt))}` : ""}`;
      await sendEmail({
        to: a.email,
        subject: `${peso(hit.price)} to ${hit.destinationName}${a.maxPrice ? ` — under your ${peso(a.maxPrice)}` : " — price dropped"}`,
        text: `${hit.origin} → ${hit.destination} (${hit.destinationName}, ${hit.countryName}) for ${peso(hit.price)}\n${when} · ${hit.airlineName}\n\nSee it: ${link}\n\nYour alert: ${describe(a)}\nStop these emails: ${stop}`,
        html: shell(`<p style="font-size:26px;font-weight:800;color:#0f7b4f;margin:0">${peso(hit.price)}</p>
          <p style="margin:4px 0 14px"><b>${hit.destinationName}</b>, ${hit.countryName} · ${hit.origin} → ${hit.destination}<br>
            ${when} · ${hit.airlineName}${hit.stops === 0 ? " · direct" : ` · ${hit.stops} stop${hit.stops > 1 ? "s" : ""}`}</p>
          <p><a href="${link}" style="background:#0b3d91;color:#fff;text-decoration:none;padding:11px 20px;border-radius:999px;display:inline-block;font-weight:600">See this fare</a></p>
          ${others.length ? `<p style="color:#667085;font-size:13px">Also matching: ${others.map((o) => `${o.destinationName} ${peso(o.price)}`).join(" · ")}</p>` : ""}
          <p style="color:#667085;font-size:12px;margin-top:20px">Your alert: ${describe(a)}.<br>
            <a href="${stop}">Stop these emails</a>.</p>`),
      });
      a.lastSent = now;
      a.lastPrice = hit.price;
      sent++;
    } catch (e) {
      console.error("alert check failed:", e.message);
    }
  }
  if (sent) save();
  return { checked: due.length, sent };
}

function start(getDeals) {
  if (!enabled()) {
    console.log("Fare alerts off (set RESEND_API_KEY and SITE_URL to switch them on).");
    return;
  }
  const run = () => check(getDeals).then(({ checked, sent }) => {
    if (checked) console.log(`Fare alerts: checked ${checked}, emailed ${sent}`);
  }).catch((e) => console.error("alert run failed:", e.message));
  setTimeout(run, 60 * 1000).unref(); // let the fare cache warm up first
  setInterval(run, CHECK_MS).unref();
}

const stats = () => ({ total: alerts.length, confirmed: alerts.filter((a) => a.confirmed).length });

module.exports = { enabled, subscribe, confirm, unsubscribe, check, start, stats, describe };
