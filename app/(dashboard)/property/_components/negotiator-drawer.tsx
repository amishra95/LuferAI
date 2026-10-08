"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

import { ResponsiveSheetContent } from "@/components/portal/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Sheet, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { createNegotiatorChat, NegotiatorPanel } from "./negotiator-panel";

/**
 * The AI negotiator as a drawer: docked right on desktop, a bottom sheet on phones.
 * The chat lives here (not in the sheet, which unmounts when closed), so the
 * conversation survives closing and reopening the drawer.
 */
export function NegotiatorDrawer({ venueId, venueName }: { venueId: string; venueName: string }) {
  const router = useRouter();
  // Approved changes alter the terms shown on the page.
  const [chat] = useState(() => createNegotiatorChat(venueId, () => router.refresh()));
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button className="">
          <Sparkles aria-hidden /> AI negotiator
        </Button>
      </SheetTrigger>
      <ResponsiveSheetContent wide className="h-dvh max-md:h-[88dvh]">
        <SheetHeader className="border-b border-line/60 px-5 pt-5 pb-4 pr-14">
          <SheetTitle className="flex items-center gap-2 text-fg">
            <Sparkles className="size-4 text-sage" aria-hidden /> AI negotiator
          </SheetTitle>
          <SheetDescription>Tune {venueName}&apos;s minimum spend and menu packages.</SheetDescription>
        </SheetHeader>
        <NegotiatorPanel chat={chat} />
      </ResponsiveSheetContent>
    </Sheet>
  );
}
