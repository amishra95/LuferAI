import type { Metadata, Viewport } from "next";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

// Type: Plus Jakarta Sans for UI, Fraunces for display headings,
// Geist Mono (self-hosted) for code only. next/font self-hosts the Google fonts.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-jakarta", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], weight: ["600"], variable: "--font-fraunces", display: "swap" });
const geistMono = GeistMono;

export const viewport: Viewport = {
  // Linen canvas (light) / ink canvas (dark); mirrors --color-linen and --color-ink.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8F7F4" },
    { media: "(prefers-color-scheme: dark)", color: "#111316" },
  ],
  colorScheme: "light dark",
  // Edge-to-edge (incl. Capacitor shells); layouts pad via --app-safe-* in globals.css.
  viewportFit: "cover",
};

const DESCRIPTION =
  "Book team offsites, client dinners and corporate events in India. AI venue sourcing, direct quotes, pre-spend policy, WhatsApp approvals and GST-correct invoices with ITC tracked.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl("http://localhost:3000")),
  title: {
    default: "Lufer.ai — Corporate events & hospitality for India",
    template: "%s · Lufer.ai",
  },
  description: DESCRIPTION,
  applicationName: "Lufer.ai",
  keywords: ["corporate events India", "team offsite", "venue booking", "corporate hospitality", "GST invoice", "SAC 998596", "event procurement"],
  openGraph: { type: "website", siteName: "Lufer.ai", locale: "en_IN", title: "Lufer.ai — Corporate events & hospitality for India", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "Lufer.ai — Corporate events & hospitality for India", description: DESCRIPTION },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
