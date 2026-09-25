// Fare alerts: someone asks to hear when a route drops below a price, and we email them.
// Double opt-in (nobody gets mail they didn't confirm), one-click unsubscribe, and a cap per
// address so the list can't be used to spam someone.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "alerts.json");
const MAX_PER_EMAIL = 5;
const RESEND_KEY = process.env.RESEND_API_KEY || "";
const FROM = process.env.ALERT_FROM || "Lipad <onboarding@resend.dev>";
const SITE = (process.env.SITE_URL || "").replace(/\/$/, "");
const CHECK_MS = 6 * 60 * 60 * 1000;
const QUIET_MS = 3 * 24 * 60 * 60 * 1000; // don't email the same alert more than every 3 days

const enabled = () => Boolean(RESEND_KEY && SITE);

let alerts = [];
try { alerts = JSON.parse(fs.readFileSync(FILE, "utf8")).alerts || []; } catch { alerts = []; }

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ alerts }, null, 2));
  fs.renameSync(tmp, FILE);
}

const peso = (n) => "₱" + Math.round(n).toLocaleString("en-PH");
const token = () => crypto.randomBytes(16).toString("hex");
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e || "");

async function sendEmail({ to, subject, text, html }) {
  if (!RESEND_KEY) throw new Error("Email is not configured on this server.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
  });
  if (!res.ok) throw new Error(`Email service said ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const routeLabel = (a) =>
  `${a.origin === "ALL" ? "anywhere in the Philippines" : a.origin} → ${a.dest ? a.dest : "anywhere"}`;

// ---------- signing up ----------
async function subscribe({ email, origin, dest, trip, maxPrice }) {
  if (!enabled()) throw new Error("Fare alerts aren't switched on for this site yet.");
  if (!validEmail(email)) throw new Error("That email address doesn't look right.");
  const price = Math.round(Number(maxPrice));
  if (!price || price < 500 || price > 500000) throw new Error("Pick a target price between ₱500 and ₱500,000.");

  const mine = alerts.filter((a) => a.email === email.toLowerCase());
  if (mine.length >= MAX_PER_EMAIL) throw new Error(`That address already has ${MAX_PER_EMAIL} alerts — remove one first.`);

  const alert = {
    id: token(),
    email: email.toLowerCase(),
    origin: /^[A-Z]{3}$/.test(origin || "") ? origin : "ALL",
    dest: /^[A-Z]{3}$/.test(dest || "") ? dest : "",
    trip: trip === "round" ? "round" : "oneway",
    maxPrice: price,
    confirmed: false,
    created: new Date().toISOString(),
    lastSent: 0,
    lastPrice: 0,
  };
  alerts.push(alert);
  save();

  const link = `${SITE}/alerts/confirm?t=${alert.id}`;
  await sendEmail({
    to: alert.email,
    subject: "Confirm your Lipad fare alert",
    text: `Confirm your alert for ${routeLabel(alert)} under ${peso(alert.maxPrice)}:\n${link}\n\nIf you didn't ask for this, ignore this email and nothing will be sent.`,
    html: `<p>You asked to hear when <b>${routeLabel(alert)}</b> drops below <b>${peso(alert.maxPrice)}</b>.</p>
      <p><a href="${link}">Confirm this alert</a></p>
      <p style="color:#667085;font-size:13px">If you didn't ask for this, ignore this email — nothing more will be sent.</p>`,
  });
  return { ok: true };
}

function confirm(id) {
  const a = alerts.find((x) => x.id === id);
  if (!a) return null;
  a.confirmed = true;
  save();
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
// getDeals is injected so this file doesn't reach into the fare cache itself.
async function check(getDeals) {
  if (!enabled()) return { checked: 0, sent: 0 };
  const now = Date.now();
  let sent = 0;
  const due = alerts.filter((a) => a.confirmed && now - a.lastSent > QUIET_MS);

  for (const a of due) {
    try {
      const { deals } = await getDeals({
        origin: a.origin, oneWay: a.trip === "oneway", direct: false,
        from: "", to: "", returnBy: "", minNights: 0, maxNights: 0,
        dest: a.dest ? [a.dest] : [],
      });
      const hit = (deals || []).filter((d) => d.price <= a.maxPrice).sort((x, y) => x.price - y.price)[0];
      // Only worth an email if it's under target and better than whatever we last told them.
      if (!hit || (a.lastPrice && hit.price >= a.lastPrice)) continue;

      const link = hit.link.replace("{adults}%20adults", "1%20adult").replace("{adults}", "1");
      const stop = `${SITE}/alerts/unsubscribe?t=${a.id}`;
      const when = hit.departAt.slice(0, 10);
      await sendEmail({
        to: a.email,
        subject: `${peso(hit.price)} to ${hit.destinationName} — below your ${peso(a.maxPrice)} alert`,
        text: `${hit.origin} → ${hit.destination} (${hit.destinationName}) for ${peso(hit.price)} on ${when}, ${hit.airlineName}.\n\nSee it: ${link}\n\nStop these emails: ${stop}`,
        html: `<p><b>${hit.destinationName}</b> for <b>${peso(hit.price)}</b> — you asked to hear under ${peso(a.maxPrice)}.</p>
          <p>${hit.origin} → ${hit.destination} · ${when} · ${hit.airlineName}${hit.returnAt ? ` · back ${hit.returnAt.slice(0, 10)}` : ""}</p>
          <p><a href="${link}">See this fare</a></p>
          <p style="color:#667085;font-size:13px">Prices change fast, so this one may already be gone.
          <a href="${stop}">Stop these emails</a>.</p>`,
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

module.exports = { enabled, subscribe, confirm, unsubscribe, check, start, stats, routeLabel, peso };
