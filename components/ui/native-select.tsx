import * as React from "react";

import { cn } from "@/lib/utils";

/** Styled native <select>, matching shadcn Input. Works in forms without client JS. */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "border-input flex h-9 w-full pointer-coarse:h-11 bg-zinc-950/40 rounded-md border px-3 py-1 text-base shadow-xs outline-none md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { NativeSelect };
