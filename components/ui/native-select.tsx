import * as React from "react";

import { cn } from "@/lib/utils";

/** Styled native <select>, matching shadcn Input. Works in forms without client JS. */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "field disabled:cursor-not-allowed",
        "aria-invalid:border-rose",
        className
      )}
      {...props}
    />
  );
}

export { NativeSelect };
