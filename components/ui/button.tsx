import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Built on the dashboard's btn utilities so portal and dashboard buttons are identical.
  "btn shrink-0 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 aria-invalid:border-rose",
  {
    variants: {
      variant: {
        default: "btn-primary",
        destructive: "border-error-ink bg-error-ink text-white hover:border-error-ink hover:bg-error-ink/90 hover:text-white",
        outline: "",
        secondary: "btn-secondary",
        ghost: "btn-ghost",
        link: "text-link h-auto border-transparent bg-transparent px-0 underline-offset-4 hover:border-transparent hover:bg-transparent hover:underline",
      },
      size: {
        // pointer-coarse: 44px minimum touch targets on touch screens (WCAG 2.5.5).
        default: "h-9 px-4 text-meta has-[>svg]:px-3 pointer-coarse:min-h-11",
        sm: "h-7 px-2.5 has-[>svg]:px-2 pointer-coarse:min-h-11",
        lg: "h-11 px-5 text-body pointer-coarse:min-h-11",
        icon: "size-9 px-0 pointer-coarse:size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
