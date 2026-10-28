import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

// Index the public pages only; portals, workspace and APIs sit behind sign-in anyway.
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl("http://localhost:3000");
  return {
    rules: { userAgent: "*", allow: ["/", "/signup", "/login", "/inquire/"], disallow: ["/api/", "/admin", "/client", "/property", "/partner", "/dashboard", "/settings", "/agents", "/chat", "/venues", "/governance", "/control-tower", "/contracts", "/quote/", "/rsvp/"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
