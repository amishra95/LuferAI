/**
 * The contract lifecycle (migration 0031), in the app's words:
 *
 *   awaiting_client ─► awaiting_venue ─► executed
 *     (client signs)    (venue countersigns: the booking is confirmed)
 *   …declined by a signer, or voided (by a party, or because the booking was cancelled).
 *
 * contracts_guard_update and contract_signatures_check enforce the same rules in
 * Postgres; these mirror them for the UI, the API and the provider callbacks.
 *
 * Pure: tests import it directly (tests/contracts.test.mjs).
 */

export const CONTRACT_STATUSES = ["awaiting_client", "awaiting_venue", "executed", "declined", "voided"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export type ContractParty = "client" | "venue";

export const STATUS_LABEL: Record<ContractStatus, string> = {
  awaiting_client: "Awaiting client signature",
  awaiting_venue: "Awaiting venue countersignature",
  executed: "Executed",
  declined: "Declined",
  voided: "Voided",
};

const NEXT: Record<ContractStatus, readonly ContractStatus[]> = {
  awaiting_client: ["awaiting_venue", "declined", "voided"],
  awaiting_venue: ["executed", "declined", "voided"],
  executed: [],
  declined: [],
  voided: [],
};

export const canMove = (from: ContractStatus, to: ContractStatus) => NEXT[from].includes(to);
export const isLive = (s: ContractStatus) => s === "awaiting_client" || s === "awaiting_venue" || s === "executed";
export const isOpen = (s: ContractStatus) => s === "awaiting_client" || s === "awaiting_venue";

/** Whose signature the contract waits for, or null. */
export function awaitedParty(status: ContractStatus): ContractParty | null {
  return status === "awaiting_client" ? "client" : status === "awaiting_venue" ? "venue" : null;
}

/** The status a signature by `party` moves the contract to, or why it can't sign. */
export function afterSignature(status: ContractStatus, party: ContractParty): { ok: true; status: ContractStatus } | { ok: false; reason: string } {
  const awaited = awaitedParty(status);
  if (awaited === null) return { ok: false, reason: `The contract is ${STATUS_LABEL[status].toLowerCase()}.` };
  if (awaited !== party) return { ok: false, reason: party === "venue" ? "The client signs first; the venue countersigns after." : "The client has already signed." };
  return { ok: true, status: party === "client" ? "awaiting_venue" : "executed" };
}

export interface Signer {
  role: "ADMIN" | "CLIENT" | "PROPERTY" | "PARTNER" | string;
  companyId: string | null;
  venueId: string | null;
  corporateRole: string | null;
}

/**
 * Which party a member signs for on this contract, or why they can't. Clients sign
 * through an Approver (their authorised signatory); venues through their own managers.
 * Admins can see every contract but never sign for either side.
 */
export function signingParty(m: Signer, contract: { tenant_id: string; venue_id: string; status: ContractStatus }): { ok: true; party: ContractParty } | { ok: false; reason: string } {
  const awaited = awaitedParty(contract.status);
  if (!awaited) return { ok: false, reason: `The contract is ${STATUS_LABEL[contract.status].toLowerCase()}.` };
  if (m.role === "CLIENT" && m.companyId === contract.tenant_id) {
    if (m.corporateRole !== "APPROVER") return { ok: false, reason: "Only an Approver can sign contracts for your company." };
    return awaited === "client" ? { ok: true, party: "client" } : { ok: false, reason: "Signed by your company; waiting for the venue's countersignature." };
  }
  if (m.role === "PROPERTY" && m.venueId === contract.venue_id) {
    return awaited === "venue" ? { ok: true, party: "venue" } : { ok: false, reason: "The client signs first; you countersign after." };
  }
  return { ok: false, reason: "Only the client's Approvers and the venue's managers sign this contract." };
}

/** Whether a member may see the contract at all. */
export function canViewContract(m: Signer, contract: { tenant_id: string; venue_id: string }): boolean {
  return m.role === "ADMIN" || (m.role === "CLIENT" && m.companyId === contract.tenant_id) || (m.role === "PROPERTY" && m.venueId === contract.venue_id);
}

/** Either party (or an admin) may void a contract before it's executed; a voided one can be reissued. */
export function canVoid(m: Signer, contract: { tenant_id: string; venue_id: string; status: ContractStatus }): boolean {
  if (!isOpen(contract.status)) return false;
  return m.role === "ADMIN" || (m.role === "CLIENT" && m.companyId === contract.tenant_id && m.corporateRole === "APPROVER") || (m.role === "PROPERTY" && m.venueId === contract.venue_id);
}

/** Issuing: a booking with the venue (PENDING), with no live contract. Organizers, Approvers, the venue or an admin. */
export function issueRefusal(m: Signer, booking: { company_id: string; venue_id: string; status: string }, live: boolean): string | null {
  const party = m.role === "ADMIN" || (m.role === "CLIENT" && m.companyId === booking.company_id && m.corporateRole !== "FINANCE_VIEWER") || (m.role === "PROPERTY" && m.venueId === booking.venue_id);
  if (!party) return "Only the booking's company, its venue or an admin can issue its contract.";
  if (booking.status !== "PENDING") return booking.status === "PENDING_APPROVAL" ? "The booking is still awaiting internal approval." : `Contracts are issued while the booking is with the venue (this one is ${booking.status.toLowerCase().replace("_", " ")}).`;
  if (live) return "This booking already has a live contract. Void it first to issue a new revision.";
  return null;
}
