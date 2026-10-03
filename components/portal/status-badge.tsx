import { Badge } from "@/components/ui/badge";
import type { BookingStatus, GstType, OnboardingStatus } from "@/lib/supabase/database.types";

const BOOKING_VARIANT = {
  PENDING: "warning",
  CONFIRMED: "default",
  COMPLETED: "success",
  CANCELLED: "destructive",
} as const satisfies Record<BookingStatus, string>;

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Badge variant={BOOKING_VARIANT[status]}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

export function GstTypeBadge({ type }: { type: GstType }) {
  return (
    <Badge variant="outline" title={type === "IGST" ? "Integrated GST 18% (inter-state)" : "Central 9% + State 9% (intra-state)"}>
      {type === "IGST" ? "IGST 18%" : "CGST + SGST 18%"}
    </Badge>
  );
}

export function OnboardingStatusBadge({ status }: { status: OnboardingStatus }) {
  const label = status === "UNDER_REVIEW" ? "Under review" : status.charAt(0) + status.slice(1).toLowerCase();
  return <Badge variant={status === "UNDER_REVIEW" ? "secondary" : "outline"}>{label}</Badge>;
}
