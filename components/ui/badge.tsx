import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/** Status pill in the Lufer style: mono, rounded, tinted. Always carries a text label. */
const badgeVariants = cva(
  "inline-flex h-[22px] w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2 font-mono text-[10.5px] tracking-[0.02em] whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-line bg-surface text-fg shadow-[0_1px_1px_rgb(9_9_11/0.03)]",
        secondary: "border-transparent bg-surface-raised text-fg-muted",
        destructive: "border-rose/25 bg-rose/[0.06] text-rose",
        outline: "border-line bg-transparent text-fg-muted",
        success: "border-sage/25 bg-sage/[0.07] text-sage",
        warning: "border-copper-deep/30 bg-copper/10 text-copper-ink",
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
