"use client";

import { useState } from "react";

import type { VenueOption, VenueSearchFilters } from "@/lib/ai/venue-sourcing";
import { AiVenueSearch } from "./ai-venue-search";
import { EventRequestForm, type VenuePrefill } from "./event-request-form";

type EventRequestFormProps = React.ComponentProps<typeof EventRequestForm>;

/** AI venue search plus the request form, so a chosen result can fill in the form. */
export function RequestEventPanel(props: Omit<EventRequestFormProps, "prefill">) {
  const [prefill, setPrefill] = useState<VenuePrefill>();

  function selectVenue(option: VenueOption, filters: VenueSearchFilters) {
    // estimatedPerHead already covers the venue's minimum spend for this group.
    setPrefill({ venueId: option.venue.id, partySize: filters.minCapacity, perHead: option.estimatedPerHead });
    // The date is the one field search can't fill: take the user there.
    requestAnimationFrame(() => {
      const date = document.getElementById("event_date");
      date?.scrollIntoView({ behavior: "smooth", block: "center" });
      date?.focus({ preventScroll: true });
    });
  }

  return (
    <>
      <AiVenueSearch companyId={props.companyId} onSelect={selectVenue} />
      <EventRequestForm {...props} prefill={prefill} />
    </>
  );
}
