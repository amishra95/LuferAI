"use client";

import { Button } from "@/components/ui/button";

export default function PropertyError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h2 className="text-section font-semibold">That action didn&apos;t go through</h2>
      <p className="text-muted-foreground mt-2 text-body">{error.message}</p>
      <Button className="mt-6" onClick={reset}>
        Back to bookings
      </Button>
    </div>
  );
}
