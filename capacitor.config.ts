import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shells (iOS / Android) for the Next.js app.
 *
 * The app can't be statically exported — it relies on middleware (auth/RBAC,
 * rate limits), Server Components, Server Actions and API routes — so the native
 * WebView loads the deployed site from CAP_SERVER_URL. `webDir` only holds the
 * bundled offline/error page that `npx cap sync` copies into the native projects.
 *
 *   CAP_SERVER_URL=https://app.example.com npx cap sync          # release
 *   CAP_SERVER_URL=http://192.168.1.20:3000 npx cap sync         # device on LAN, `next dev -H 0.0.0.0`
 *
 * Capacitor documents server.url as intended for live reload; see README notes on
 * store review before shipping a remote-URL build.
 */
const serverUrl = process.env.CAP_SERVER_URL?.replace(/\/$/, "");
const zinc950 = "#09090b";

const config: CapacitorConfig = {
  appId: "com.luferai.app",
  appName: "LuferAI",
  webDir: "capacitor-shell",
  backgroundColor: zinc950,

  server: serverUrl
    ? {
        url: serverUrl,
        // Only a plain-HTTP dev server needs cleartext; release URLs must be HTTPS.
        cleartext: serverUrl.startsWith("http://"),
        // Bundled page shown when the site can't be reached (offline, DNS, 5xx on load).
        errorPath: "offline.html",
        // Keep auth and payment hops inside the WebView so the session returns to the app.
        // Other external links open in the system browser.
        allowNavigation: ["*.supabase.co", "checkout.stripe.com", "*.razorpay.com"],
      }
    : { androidScheme: "https" },

  ios: {
    backgroundColor: zinc950,
    // The web layer pads for the notch / home indicator itself (env(safe-area-inset-*)).
    contentInset: "never",
  },

  android: {
    backgroundColor: zinc950,
  },

  plugins: {
    SystemBars: {
      // Edge-to-edge, plus --safe-area-inset-* CSS variables, which stay correct on
      // Android WebView < 140 where env(safe-area-inset-*) is unreliable.
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
      // Light status/navigation bar icons for the dark UI.
      style: "DARK",
    },
  },
};

export default config;
