import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted via the `geist` package (no Google Fonts fetch at build time).
const geistSans = GeistSans;
const geistMono = GeistMono;
// Editorial display serif (page titles, venue names, the wordmark). Fraunces'
// variable weight + optical-size cut, self-hosted from @fontsource-variable/fraunces.
const fraunces = localFont({
  src: "../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-opsz-normal.woff2",
  variable: "--font-fraunces",
  weight: "100 900",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
  // Edge-to-edge (incl. Capacitor shells); layouts pad via --app-safe-* in globals.css.
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "CorpHospitality — Enterprise event procurement for India",
    template: "%s · CorpHospitality",
  },
  description:
    "A three-sided marketplace connecting corporates, venues and the platform for GST-compliant hospitality procurement.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // Dark-only theme; `dark` also drives shadcn chart/sheet variants.
      className={`dark ${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
