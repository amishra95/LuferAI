"use client";

import { Button } from "@/components/ui/button";

export default function PropertyError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h2 className="text-lg font-semibold">That action didn&apos;t go through</h2>
      <p className="text-muted-foreground mt-2 text-sm">{error.message}</p>
      <Button className="mt-6" onClick={reset}>
        Back to bookings
      </Button>
    </div>
  );
}
