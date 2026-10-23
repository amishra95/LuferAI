import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DoorClosed, MapPin, Users } from "lucide-react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { venueFacts } from "@/lib/venues/inquiry-store";
import { InquiryChat } from "./_components/inquiry-chat";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps<"/inquire/[venueId]">): Promise<Metadata> {
  const { venueId } = await params;
  const facts = UUID.test(venueId) ? await venueFacts(venueId) : null;
  return { title: facts ? `Plan an event at ${facts.venue.name}` : "Venue inquiry" };
}

/** A venue's public inquiry page: ask about an event and get answers (and a quote) without an account. */
export default async function InquirePage({ params }: PageProps<"/inquire/[venueId]">) {
  const { venueId } = await params;
  const facts = UUID.test(venueId) ? await venueFacts(venueId) : null;
  if (!facts) notFound();
  const { venue } = facts;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 pt-[calc(1.5rem+var(--app-safe-top))] pb-[calc(1.5rem+var(--app-safe-bottom))]">
      <Card>
        <CardHeader>
          <p className="text-fg-subtle text-caption font-medium">Corporate events</p>
          <CardTitle className="text-section">{venue.name}</CardTitle>
          <CardDescription className="flex flex-wrap gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden /> {venue.neighborhood}, {venue.city}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" aria-hidden /> Up to {venue.capacity_max} guests
            </span>
            {venue.pdr_available ? (
              <span className="inline-flex items-center gap-1">
                <DoorClosed className="size-3.5" aria-hidden /> Private room
              </span>
            ) : null}
          </CardDescription>
        </CardHeader>
      </Card>
      <InquiryChat venueId={venue.id} venueName={venue.name} />
      <p className="text-fg-faint text-center text-caption">Answers come from an AI assistant using {venue.name}&apos;s own details. The venue team confirms every quote.</p>
    </main>
  );
}
