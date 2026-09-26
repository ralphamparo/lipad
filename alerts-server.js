// Fare alerts: someone describes a trip they'd like, and we email them when a matching fare shows up.
// Double opt-in (nobody gets mail they didn't confirm), one-click unsubscribe, and a cap per
// address so the list can't be used to spam someone.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Tests point LIPAD_DATA_DIR somewhere temporary so they can never touch real subscribers.
const DATA_DIR = process.env.LIPAD_DATA_DIR || path.join(__dirname, "data");
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
// A handful of country names read wrong without "the".
const THE = /^(Philippines|United States|United Kingdom|United Arab Emirates|Netherlands|Maldives|Bahamas|Czech Republic|Dominican Republic|Marshall Islands|Solomon Islands|Cook Islands|Seychelles)$/;
const theName = (n) => (THE.test(n) ? "the " + n : n);

function whereLabel(a) {
  if (a.scope === "city") return a.scopeLabel || a.scopeValue;
  if (a.scope === "country") return theName(a.scopeLabel || a.scopeValue);
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
  if (a.kind === "piso") bits.push("whenever it hits piso-fare level — as cheap as that route ever gets");
  else if (a.kind === "sale") bits.push(`whenever a fare is at least ${a.minDiscount}% below its usual price`);
  else bits.push(a.maxPrice ? `under ${peso(a.maxPrice)}` : "whenever the price drops");
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

  const kind = ["sale", "piso"].includes(input.kind) ? input.kind : "price";
  const minDiscount = Math.min(80, Math.max(15, Math.round(Number(input.minDiscount) || 30)));
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
    kind,
    minDiscount,
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

  const link = `${SITE}/alerts/confirm?t=${alert.id}`;
  // Send first: if the email can't go out, there's no point keeping an alert nobody can confirm.
  try {
    await sendConfirmation(alert, link);
  } catch (e) {
    console.error("confirmation email failed for", alert.email, "-", e.message);
    throw new Error("We couldn't send the confirmation email. Check the address and try again.");
  }
  alert.lastConfirmSent = Date.now();
  alerts.push(alert);
  save();
  return { ok: true };
}

async function sendConfirmation(alert, link) {
  await sendEmail({
    to: alert.email,
    subject: "Confirm your Lipad fare alert",
    text: `Confirm this alert to start receiving deals:\n${describe(alert)}\n\n${link}\n\nIf you didn't ask for this, ignore this email and nothing will be sent.`,
    // Big, full-width button with the link spelled out underneath: phone clients often shrink
    // styled links, and some strip the styling altogether.
    html: shell(`<p style="font-size:17px;margin:0 0 6px"><b>One tap and we'll start watching this trip:</b></p>
      <p style="background:#f6f3ee;border-radius:10px;padding:12px 14px;margin:0 0 20px">${describe(alert)}</p>
      <a href="${link}" style="background:#0b3d91;color:#ffffff;text-decoration:none;padding:16px 24px;border-radius:12px;display:block;text-align:center;font-weight:700;font-size:18px;line-height:1.2">Confirm this alert →</a>
      <p style="color:#667085;font-size:13px;margin:14px 0 0">Button not working? Paste this into your browser:<br>
        <span style="word-break:break-all;color:#0b3d91">${link}</span></p>
      <p style="color:#667085;font-size:13px">If you didn't ask for this, ignore this email — nothing more will be sent.</p>`),
  });
}

// Confirming turns the alert on. No second email: the confirmation page says what's being
// watched, and an extra message is one more thing for a spam filter to judge.
function confirm(id) {
  const a = alerts.find((x) => x.id === id);
  if (!a) return null;
  a.confirmed = true;
  save();
  return a;
}

const RESEND_GAP_MS = 5 * 60 * 1000;
async function resend(email) {
  const who = String(email || "").trim().toLowerCase();
  const pending = alerts.filter((a) => a.email === who && !a.confirmed);
  // Say the same thing either way, so this cannot be used to find out who has signed up.
  if (!pending.length) return { ok: true };
  const a = pending[pending.length - 1];
  if (Date.now() - (a.lastConfirmSent || 0) < RESEND_GAP_MS) return { ok: true };
  a.lastConfirmSent = Date.now();
  save();
  await sendConfirmation(a, `${SITE}/alerts/confirm?t=${a.id}`);
  return { ok: true };
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
async function check(providers) {
  const { getDeals, getSales, getPiso } = typeof providers === "function"
    ? { getDeals: providers, getSales: providers, getPiso: providers }
    : providers;
  if (!enabled()) return { checked: 0, sent: 0 };
  const now = Date.now();
  let sent = 0;
  const due = alerts.filter((a) => a.confirmed && now - a.lastSent > QUIET_MS);

  for (const a of due) {
    try {
      const source = a.kind === "piso" ? getPiso : a.kind === "sale" ? getSales : getDeals;
      const { deals } = await source({
        origin: a.origin,
        oneWay: a.trip === "oneway",
        direct: a.direct,
        from: a.from, to: a.to, returnBy: "",
        minNights: a.minNights, maxNights: a.maxNights,
        dest: a.scope === "city" ? [a.scopeValue] : [],
      });
      const matching = (deals || [])
        .filter((d) => matchesScope(d, a) && (a.kind !== "sale" || d.discount >= a.minDiscount))
        .sort((x, y) => (a.kind === "sale" ? y.discount - x.discount : x.price - y.price));
      const hit = matching[0];
      if (!hit) continue;
      // With a target price: anything under it. Without one: only a genuine drop on what we last sent.
      const worth = a.kind !== "price" ? true : (a.maxPrice ? hit.price <= a.maxPrice : true);
      const staleRepeat = a.kind === "price" ? (a.lastPrice && hit.price >= a.lastPrice) : a.lastPrice === hit.price;
      if (!worth || staleRepeat) continue;

      const link = hit.link.replace("{adults}%20adults", "1%20adult").replace("{adults}", "1");
      const stop = `${SITE}/alerts/unsubscribe?t=${a.id}`;
      const others = matching.slice(1, 4);
      const when = `${pretty(day(hit.departAt))}${hit.returnAt ? ` → ${pretty(day(hit.returnAt))}` : ""}`;
      await sendEmail({
        to: a.email,
        subject: a.kind === "piso"
          ? `Piso-fare level: ${peso(hit.price)} to ${hit.destinationName}`
          : a.kind === "sale"
          ? `${hit.discount}% off: ${peso(hit.price)} to ${hit.destinationName}`
          : `${peso(hit.price)} to ${hit.destinationName}${a.maxPrice ? ` — under your ${peso(a.maxPrice)}` : " — price dropped"}`,
        text: `${hit.origin} → ${hit.destination} (${hit.destinationName}, ${hit.countryName}) for ${peso(hit.price)}\n${when} · ${hit.airlineName}\n\nSee it: ${link}\n\nYour alert: ${describe(a)}\nStop these emails: ${stop}`,
        html: shell(`<p style="font-size:26px;font-weight:800;color:#0f7b4f;margin:0">${peso(hit.price)}${hit.typical ? ` <span style="font-size:15px;color:#667085;font-weight:500"><s>${peso(hit.typical)}</s> usually · ${hit.discount}% off</span>` : ""}</p>
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

function start(providers) {
  if (!enabled()) {
    console.log("Fare alerts off (set RESEND_API_KEY and SITE_URL to switch them on).");
    return;
  }
  const run = () => check(providers).then(({ checked, sent }) => {
    if (checked) console.log(`Fare alerts: checked ${checked}, emailed ${sent}`);
  }).catch((e) => console.error("alert run failed:", e.message));
  setTimeout(run, 60 * 1000).unref(); // let the fare cache warm up first
  setInterval(run, CHECK_MS).unref();
}

const stats = () => ({ total: alerts.length, confirmed: alerts.filter((a) => a.confirmed).length });

module.exports = { enabled, subscribe, resend, confirm, unsubscribe, check, start, stats, describe };
