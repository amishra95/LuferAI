"use client";

import { useEffect } from "react";

import { ErrorFallback } from "@/components/dashboard/error-boundary";
import { Page } from "@/components/dashboard/page-header";

/** Route-level fallback for every dashboard page: the shell (sidebar, header) stays usable. */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("dashboard page failed", error);
  }, [error]);

  return (
    <Page width="narrow">
      <ErrorFallback
        title="This page couldn't load"
        message={error.digest ? `Something went wrong on the server (ref ${error.digest}).` : error.message}
        onRetry={reset}
      />
    </Page>
  );
}
