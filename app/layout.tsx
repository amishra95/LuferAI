import type { Metadata, Viewport } from "next";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

// Velvet Night type: Plus Jakarta Sans for UI, Fraunces for display headings,
// Geist Mono (self-hosted) for code only. next/font self-hosts the Google fonts.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-jakarta", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], weight: ["600"], variable: "--font-fraunces", display: "swap" });
const geistMono = GeistMono;

export const viewport: Viewport = {
  // Plum brand bar (light) / ink canvas (dark); mirrors --color-plum and --color-ink.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2A1B3D" },
    { media: "(prefers-color-scheme: dark)", color: "#1A1523" },
  ],
  colorScheme: "light dark",
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
    <html lang="en" className={`${jakarta.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
