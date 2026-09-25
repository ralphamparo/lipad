// Edit this file to turn things on — no code changes needed.
window.LIPAD = {
  // Google AdSense. Leave blank and no ads are shown at all.
  // 1. Apply at https://adsense.google.com with your deployed domain.
  // 2. Once approved, create two display ad units and paste the IDs here.
  adsenseClient: "",        // e.g. "ca-pub-1234567890123456"
  adsenseSlotTop: "",       // e.g. "1234567890"
  adsenseSlotMid: "",       // shown between results once there are more than 8
  adsenseSlotBottom: "",    // e.g. "0987654321"

  // Where the fare API lives. Blank means "same site as this page", which is right for the
  // website. A packaged Android/iOS build (Capacitor) sets this to the deployed URL instead,
  // e.g. "https://lipad.example.com".
  // Travelpayouts partner marker for hotel links (same marker as flights). Blank hides the hotel link.
  hotelMarker: "",

  apiBase: "",

  // AdMob, used only by the packaged Android/iOS app (the website uses AdSense above).
  // Leave bannerId blank to show Googles test banner while developing.
  admob: {
    bannerId: "",   // e.g. "ca-app-pub-1234567890123456/1234567890"
    testing: false, // true = always show test ads, even with a real bannerId
  },
};
