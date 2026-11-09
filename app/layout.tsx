import type { Metadata, Viewport } from "next";
import { Anek_Latin, Courier_Prime } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

// Bill Book type: Anek Latin (Ek Type) for every voice, its width axis setting
// the wide display headers; Courier Prime for written-in entries on bill sheets;
// Geist Mono (self-hosted) for code only. next/font self-hosts the Google fonts.
const anek = Anek_Latin({ subsets: ["latin", "latin-ext"], axes: ["wdth"], variable: "--font-anek", display: "swap" });
const courierPrime = Courier_Prime({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-courier-prime", display: "swap" });
const geistMono = GeistMono;

export const viewport: Viewport = {
  // Ink black in both schemes (the header cover / dark canvas); mirrors --color-ink.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1A1714" },
    { media: "(prefers-color-scheme: dark)", color: "#1A1714" },
  ],
  colorScheme: "light dark",
  // Edge-to-edge (incl. Capacitor shells); layouts pad via --app-safe-* in globals.css.
  viewportFit: "cover",
};

const DESCRIPTION =
  "Book team offsites, client dinners and corporate events in Bengaluru. Venues that fit your policy, direct quotes, approvals before any spend and a GST invoice for every booking.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl("http://localhost:3000")),
  title: {
    default: "Lufer — Corporate events & hospitality in Bengaluru",
    template: "%s · Lufer",
  },
  description: DESCRIPTION,
  applicationName: "Lufer",
  keywords: ["corporate events Bengaluru", "team offsite", "venue booking", "corporate hospitality", "GST invoice", "SAC 998596", "event procurement"],
  openGraph: { type: "website", siteName: "Lufer", locale: "en_IN", title: "Lufer — Corporate events & hospitality in Bengaluru", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "Lufer — Corporate events & hospitality in Bengaluru", description: DESCRIPTION },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${anek.variable} ${courierPrime.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        {/* Page views and Core Web Vitals; both no-op outside Vercel. Enable them under Project → Analytics / Speed Insights. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
