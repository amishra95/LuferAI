import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/** Badge: soft tinted background with dark text of the same colour family. Always carries a text label. */
const badgeVariants = cva(
  // Flat label; status variants use the soft palette (mint / gold / error) and lead with a dot.
  "inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-badge border px-2.5 py-0.5 text-caption leading-4 font-medium tabular-nums whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-line text-fg",
        secondary: "border-transparent bg-surface-raised text-fg-muted",
        destructive: "badge-danger before:status-dot before:bg-rose before:content-['']",
        outline: "border-line text-fg-subtle",
        success: "badge-success before:status-dot before:bg-sage before:content-['']",
        warning: "badge-warn before:status-dot before:bg-warn before:content-['']",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
