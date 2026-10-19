import "server-only";

import { z } from "zod";

import type { Member } from "@/lib/auth/session";
import { decideApproval, listApprovals, listPortalUsers } from "@/lib/data";
import { publishApproval } from "@/lib/telemetry/live";
import { canManageGovernance } from "./access";
import { parseRuleInput, type ApprovalRule } from "./approvalEngine";
import { checkSpend, parseBudgetInput, type SpendCheck, type TeamBudget } from "./budgetService";
import {
  deleteBudget,
  deleteRule,
  escalateApproval,
  GovernanceError,
  listBudgets,
  saveBudget,
  saveHierarchy,
  saveRule,
  setRuleActive,
  type HierarchyTier,
} from "./governanceStore";

/**
 * The governance commands behind POST /api/enterprise/approvals,
 * POST /api/enterprise/budgets and the /governance page's server actions, so
 * every entry point authorises and validates the same way. The company always
 * comes from the caller's session (an admin's pick for admins), never the body.
 */

const money = z.union([z.number(), z.string().max(24)]);

export const ApprovalCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("decide"), approvalId: z.uuid(), decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("escalate"), approvalId: z.uuid(), reason: z.string().max(280).optional() }),
  z.object({
    action: z.literal("saveRule"),
    id: z.uuid().optional(),
    name: z.string().max(200),
    departmentId: z.uuid().nullable().optional(),
    minAmount: money.optional(),
    maxAmount: money.nullable().optional(),
    levels: z.union([z.number(), z.string().max(4)]),
    slaHours: z.union([z.number(), z.string().max(4)]).optional(),
  }),
  z.object({ action: z.literal("setRuleActive"), id: z.uuid(), active: z.boolean() }),
  z.object({ action: z.literal("deleteRule"), id: z.uuid() }),
  z.object({ action: z.literal("saveHierarchy"), approverIds: z.array(z.uuid()).max(10) }),
]);
export type ApprovalCommand = z.infer<typeof ApprovalCommand>;

export const BudgetCommand = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    departmentId: z.uuid(),
    period: z.enum(["monthly", "quarterly"]),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    limit: money,
    enforcement: z.enum(["approval", "block"]).optional(),
  }),
  z.object({ action: z.literal("delete"), id: z.uuid() }),
  /** Dry run: would this spend fit the team's budgets? Writes nothing. */
  z.object({ action: z.literal("check"), departmentId: z.uuid(), date: z.iso.date(), amount: z.number().positive() }),
]);
export type BudgetCommand = z.infer<typeof BudgetCommand>;

function requireManager(member: Member) {
  if (!canManageGovernance(member)) throw new GovernanceError("Only Approvers and platform admins can change approval rules and budgets.", 403);
}

/** Approvers decide their own; admins decide on behalf of the assigned approver (as /client/approvals does). */
async function decisionScope(member: Member, companyId: string, approvalId: string) {
  if (member.role === "CLIENT") {
    const actor = (await listPortalUsers({ companyId })).find((u) => u.id === member.userId);
    if (actor?.role !== "APPROVER") throw new GovernanceError("Only users with the Approver role can sign off.", 403);
    return { approverId: member.userId, tenantId: companyId };
  }
  const [pending] = (await listApprovals({ tenantId: companyId, status: "PENDING" })).filter((a) => a.id === approvalId);
  if (!pending) throw new GovernanceError("This approval was not found or has already been decided.", 404);
  return { approverId: pending.approver_id, tenantId: companyId };
}

export type ApprovalCommandResult =
  | { action: "decide"; approvalId: string; decision: "APPROVED" | "REJECTED" }
  | { action: "escalate"; approvalId: string; escalatedTo: string }
  | { action: "saveRule" | "setRuleActive"; rule: ApprovalRule }
  | { action: "deleteRule"; id: string }
  | { action: "saveHierarchy"; hierarchy: HierarchyTier[] };

export async function runApprovalCommand(member: Member, companyId: string, cmd: ApprovalCommand): Promise<ApprovalCommandResult> {
  switch (cmd.action) {
    case "decide": {
      const scope = await decisionScope(member, companyId, cmd.approvalId);
      const [approval] = (await listApprovals({ tenantId: companyId })).filter((a) => a.id === cmd.approvalId);
      try {
        await decideApproval(cmd.approvalId, scope, cmd.decision, cmd.note?.trim() || undefined);
      } catch (err) {
        // decideApproval's messages are written for users ("Waiting for tier-1 sign-off from …").
        throw new GovernanceError(err instanceof Error ? err.message : "Could not record the decision.", 409);
      }
      await publishApproval(cmd.approvalId, approval?.booking_id ?? approval?.catalog_order_id ?? "", cmd.decision).catch((err) => console.error("governance: publish failed", err));
      return { action: "decide", approvalId: cmd.approvalId, decision: cmd.decision };
    }
    case "escalate": {
      requireManager(member);
      return { action: "escalate", approvalId: cmd.approvalId, escalatedTo: await escalateApproval(companyId, cmd.approvalId, cmd.reason?.trim() || null) };
    }
    case "saveRule": {
      requireManager(member);
      const parsed = parseRuleInput(cmd);
      if (!parsed.ok) throw new GovernanceError(parsed.error);
      return { action: "saveRule", rule: await saveRule(companyId, parsed.value, member.userId, cmd.id) };
    }
    case "setRuleActive":
      requireManager(member);
      return { action: "setRuleActive", rule: await setRuleActive(companyId, cmd.id, cmd.active) };
    case "deleteRule":
      requireManager(member);
      await deleteRule(companyId, cmd.id);
      return { action: "deleteRule", id: cmd.id };
    case "saveHierarchy":
      requireManager(member);
      return { action: "saveHierarchy", hierarchy: await saveHierarchy(companyId, cmd.approverIds) };
  }
}

export type BudgetCommandResult =
  | { action: "save"; budget: TeamBudget }
  | { action: "delete"; id: string }
  | { action: "check"; result: SpendCheck };

export async function runBudgetCommand(member: Member, companyId: string, cmd: BudgetCommand): Promise<BudgetCommandResult> {
  switch (cmd.action) {
    case "save": {
      requireManager(member);
      const parsed = parseBudgetInput(cmd);
      if (!parsed.ok) throw new GovernanceError(parsed.error);
      return { action: "save", budget: await saveBudget(companyId, parsed.value, member.userId) };
    }
    case "delete":
      requireManager(member);
      await deleteBudget(companyId, cmd.id);
      return { action: "delete", id: cmd.id };
    case "check": {
      const { budgets } = await listBudgets(companyId);
      const holds = budgets.flatMap((b) => b.holds);
      return { action: "check", result: checkSpend(budgets, holds, { tenantId: companyId, departmentId: cmd.departmentId, date: cmd.date, amount: cmd.amount }) };
    }
  }
}
