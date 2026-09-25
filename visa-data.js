// Where a Philippine passport can go with little or no visa paperwork.
// Entry rules change often — every row links out to be verified, and the page says so loudly.
// days: typical stay allowed. kind: how you get in.
//   "free"        — no visa needed on arrival
//   "arrival"     — visa issued at the border (usually paid)
//   "online"      — eTA / eVisa applied for online before you fly
//   "conditional" — only if you hold something else, e.g. a valid US/Schengen visa
window.LIPAD_VISA = {
  reviewed: "2026-09-25",
  countries: [
    // Southeast Asia
    { code: "SG", name: "Singapore", days: 30, kind: "free" },
    { code: "MY", name: "Malaysia", days: 30, kind: "free" },
    { code: "TH", name: "Thailand", days: 30, kind: "free" },
    { code: "VN", name: "Vietnam", days: 21, kind: "free" },
    { code: "ID", name: "Indonesia", days: 30, kind: "free" },
    { code: "KH", name: "Cambodia", days: 30, kind: "free" },
    { code: "LA", name: "Laos", days: 30, kind: "free" },
    { code: "BN", name: "Brunei", days: 14, kind: "free" },
    { code: "MM", name: "Myanmar", days: 14, kind: "free", note: "Check current entry conditions." },
    { code: "TL", name: "Timor-Leste", days: 30, kind: "arrival" },

    // East Asia
    { code: "HK", name: "Hong Kong", days: 14, kind: "free" },
    { code: "MO", name: "Macau", days: 30, kind: "free" },
    { code: "TW", name: "Taiwan", days: 14, kind: "free", note: "Visa-free trial — confirm it still applies." },
    { code: "MN", name: "Mongolia", days: 21, kind: "free" },
    { code: "CN", name: "China", days: 0, kind: "conditional", note: "Hainan and some group tours only." },

    // South Asia
    { code: "NP", name: "Nepal", days: 90, kind: "arrival" },
    { code: "LK", name: "Sri Lanka", days: 30, kind: "online" },
    { code: "MV", name: "Maldives", days: 30, kind: "arrival" },
    { code: "IN", name: "India", days: 30, kind: "online" },

    // Middle East
    { code: "QA", name: "Qatar", days: 30, kind: "free" },
    { code: "IL", name: "Israel", days: 90, kind: "free" },
    { code: "AE", name: "United Arab Emirates", days: 14, kind: "conditional", note: "On arrival if you hold a valid US, UK, EU or Schengen visa or residence." },
    { code: "OM", name: "Oman", days: 30, kind: "online" },
    { code: "TR", name: "Türkiye", days: 30, kind: "conditional", note: "e-Visa if you hold a valid US, UK, Schengen or Irish visa." },
    { code: "JO", name: "Jordan", days: 30, kind: "arrival" },

    // Oceania
    { code: "FJ", name: "Fiji", days: 120, kind: "free" },
    { code: "PW", name: "Palau", days: 30, kind: "arrival" },
    { code: "FM", name: "Micronesia", days: 30, kind: "free" },
    { code: "MH", name: "Marshall Islands", days: 90, kind: "arrival" },
    { code: "CK", name: "Cook Islands", days: 31, kind: "free" },
    { code: "VU", name: "Vanuatu", days: 30, kind: "free" },
    { code: "WS", name: "Samoa", days: 60, kind: "arrival" },
    { code: "PG", name: "Papua New Guinea", days: 30, kind: "arrival" },

    // Americas
    { code: "BR", name: "Brazil", days: 90, kind: "free" },
    { code: "CO", name: "Colombia", days: 90, kind: "free" },
    { code: "PE", name: "Peru", days: 183, kind: "free" },
    { code: "CL", name: "Chile", days: 90, kind: "free" },
    { code: "EC", name: "Ecuador", days: 90, kind: "free" },
    { code: "BO", name: "Bolivia", days: 90, kind: "arrival" },
    { code: "CR", name: "Costa Rica", days: 30, kind: "conditional", note: "If you hold a valid US, Canadian, Schengen, Japanese or Korean visa." },
    { code: "DO", name: "Dominican Republic", days: 30, kind: "free" },
    { code: "JM", name: "Jamaica", days: 30, kind: "free" },
    { code: "HT", name: "Haiti", days: 90, kind: "free" },
    { code: "SR", name: "Suriname", days: 90, kind: "online" },

    // Africa
    { code: "MA", name: "Morocco", days: 90, kind: "free" },
    { code: "RW", name: "Rwanda", days: 30, kind: "arrival" },
    { code: "KE", name: "Kenya", days: 90, kind: "online" },
    { code: "TZ", name: "Tanzania", days: 90, kind: "arrival" },
    { code: "UG", name: "Uganda", days: 90, kind: "online" },
    { code: "SC", name: "Seychelles", days: 30, kind: "free", note: "Visitor permit issued on arrival." },
    { code: "MU", name: "Mauritius", days: 30, kind: "free" },
    { code: "ET", name: "Ethiopia", days: 90, kind: "online" },
    { code: "EG", name: "Egypt", days: 30, kind: "conditional", note: "On arrival if you hold a valid US, UK, Schengen, Canadian or Japanese visa." },

    // Eurasia
    { code: "RU", name: "Russia", days: 16, kind: "online" },
    { code: "AM", name: "Armenia", days: 120, kind: "online" },
    { code: "AZ", name: "Azerbaijan", days: 30, kind: "online" },
    { code: "GE", name: "Georgia", days: 90, kind: "conditional", note: "If you hold a valid US, UK, EU, Schengen, Japanese or Australian visa or residence." },
  ],
};
