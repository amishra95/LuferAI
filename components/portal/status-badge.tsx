import { Badge } from "@/components/ui/badge";
import type { ApprovalStatus, BookingStatus, GstType, OnboardingStatus } from "@/lib/supabase/database.types";

const BOOKING_VARIANT = {
  PENDING_APPROVAL: "secondary",
  PENDING: "warning",
  CONFIRMED: "default",
  COMPLETED: "success",
  CANCELLED: "destructive",
} as const satisfies Record<BookingStatus, string>;

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return (
    <Badge variant={BOOKING_VARIANT[status]}>{status === "PENDING_APPROVAL" ? "Awaiting sign-off" : titleCase(status)}</Badge>
  );
}

const APPROVAL_VARIANT = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
} as const satisfies Record<ApprovalStatus, string>;

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  return <Badge variant={APPROVAL_VARIANT[status]}>{titleCase(status)}</Badge>;
}

export function GstTypeBadge({ type }: { type: GstType }) {
  return (
    <Badge variant="outline" title={type === "IGST" ? "Integrated GST 18% (inter-state)" : "Central 9% + State 9% (intra-state)"}>
      {type === "IGST" ? "IGST 18%" : "CGST + SGST 18%"}
    </Badge>
  );
}

export function OnboardingStatusBadge({ status }: { status: OnboardingStatus }) {
  const label = status === "UNDER_REVIEW" ? "Under review" : titleCase(status);
  return <Badge variant={status === "UNDER_REVIEW" ? "secondary" : "outline"}>{label}</Badge>;
}
