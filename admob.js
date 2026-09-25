// AdMob banner for the packaged Android/iOS app. Harmless in a normal browser: it does nothing
// unless the page is running inside Capacitor, where the native AdMob plugin exists.
// The website uses AdSense instead (see app.js) — AdSense is not allowed inside an app webview.
(() => {
  const native = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  if (!native) return;

  const cfg = (window.LIPAD || {}).admob || {};
  // Google's public test ad unit; replace via config.js once you have real AdMob units.
  const TEST_BANNER = "ca-app-pub-3940256099942544/6300978111";
  const adId = cfg.bannerId || TEST_BANNER;
  const isTesting = !cfg.bannerId || !!cfg.testing;

  async function start() {
    const AdMob = window.Capacitor.Plugins.AdMob;
    if (!AdMob) return;
    try {
      await AdMob.initialize({ initializeForTesting: isTesting });
      // Ask for tracking consent on iOS; on Android this resolves without a prompt.
      try { await AdMob.requestTrackingAuthorization(); } catch { /* not available on this platform */ }
      // Keep the banner clear of the results: the plugin reports its height once shown.
      AdMob.addListener("bannerAdSizeChanged", ({ height }) => {
        document.body.style.paddingBottom = (height || 0) + "px";
      });
      await AdMob.showBanner({
        adId,
        adSize: "ADAPTIVE_BANNER",
        position: "BOTTOM_CENTER",
        margin: 0,
        isTesting,
      });
    } catch (e) {
      console.warn("AdMob banner unavailable:", e && e.message);
    }
  }

  if (document.readyState === "loading") addEventListener("DOMContentLoaded", start);
  else start();
})();
