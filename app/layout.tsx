import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

// Self-hosted via the `geist` package (no Google Fonts fetch at build time).
const geistSans = GeistSans;
const geistMono = GeistMono;

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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
