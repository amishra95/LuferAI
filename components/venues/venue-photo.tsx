import { Building2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A venue's cover photo, or a neutral placeholder when it has none, so cards
 * with and without photos line up. Decorative next to the venue's name.
 */
export function VenuePhoto({ url, className }: { url: string | null | undefined; className?: string }) {
  if (!url) {
    return (
      <div aria-hidden className={cn("bg-surface-hover text-fg-subtle grid place-items-center", className)}>
        <Building2 className="size-5 opacity-60" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- Storage and partner-feed URLs; next/image would need every host configured
  return <img src={url} alt="" loading="lazy" decoding="async" className={cn("bg-surface-hover object-cover", className)} />;
}
