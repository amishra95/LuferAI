import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/** Badge: a rubber stamp. Outlined in its state colour, uppercase, always carrying a text label (never colour alone). */
const badgeVariants = cva(
  "badge-stamp inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-badge border px-2 py-0.5 text-[11px] leading-4 tabular-nums whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-link text-link",
        secondary: "border-line-strong bg-surface-raised text-fg-muted",
        destructive: "badge-danger",
        outline: "border-line-strong text-fg-subtle",
        success: "badge-success",
        warning: "badge-warn",
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
