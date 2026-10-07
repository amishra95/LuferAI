import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "field min-w-0 pointer-coarse:h-11 file:text-fg file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-[13px] file:font-medium disabled:cursor-not-allowed",
        "aria-invalid:border-rose aria-invalid:shadow-[0_0_0_3px_rgb(194_53_43/0.12)]",
        className
      )}
      {...props}
    />
  );
}

export { Input };
