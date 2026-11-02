import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl("http://localhost:3000");
  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/signup`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/signup?type=partner`, changeFrequency: "monthly", priority: 0.6 },
    ...["/terms", "/privacy", "/refunds", "/contact"].map((path) => ({ url: `${base}${path}`, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
