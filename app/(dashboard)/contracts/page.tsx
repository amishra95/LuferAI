import type { Metadata } from "next";
import Link from "next/link";
import { FileSignature } from "lucide-react";

import { Page, PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/portal/empty-state";
import { Pill, type PillTone } from "@/components/portal/pills";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireWorkspace } from "@/lib/auth/session";
import { listContractsFor } from "@/lib/services/contracts/contractStore";
import { STATUS_LABEL, type ContractStatus } from "@/lib/services/contracts/lifecycle";
import { formatDate, formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Contracts" };

const TONE: Record<ContractStatus, PillTone> = { awaiting_client: "warn", awaiting_venue: "warn", executed: "ok", declined: "error", voided: "neutral" };

export default async function ContractsPage() {
  const member = await requireWorkspace("/contracts");
  const contracts = await listContractsFor(member);

  return (
    <Page>
      <PageHeader title="Contracts" />
      {contracts.length === 0 ? (
        <EmptyState icon={FileSignature} title="No contracts yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contract</TableHead>
                <TableHead>{member.role === "PROPERTY" ? "Client" : "Venue"}</TableHead>
                <TableHead>Event</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/contracts/${c.id}`} className="font-medium hover:underline">
                      {c.number}
                    </Link>
                  </TableCell>
                  <TableCell>{c.counterparty}</TableCell>
                  <TableCell>{formatDate(c.eventDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(c.total, true)}</TableCell>
                  <TableCell>
                    <Pill tone={TONE[c.status]}>{STATUS_LABEL[c.status]}</Pill>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Page>
  );
}
