import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/** Status pill in the Lufer style: mono, rounded, tinted. Always carries a text label. */
const badgeVariants = cva(
  // Flat label; status variants lead with a solid dot (the text always names the state).
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-[4px] border px-1.5 font-mono text-[10.5px] whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-line text-fg",
        secondary: "border-transparent bg-surface-raised text-fg-muted",
        destructive: "border-line text-fg-muted before:status-dot before:bg-rose before:content-['']",
        outline: "border-line text-fg-subtle",
        success: "border-line text-fg-muted before:status-dot before:bg-sage before:content-['']",
        warning: "border-line text-fg-muted before:status-dot before:bg-warn before:content-['']",
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
