import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";

import { NoticePill, Page, PageHeader, SectionLabel } from "@/components/dashboard/page-header";
import { POLICY_STATUS_META, PolicyBadge } from "@/components/policy/policy-badge";
import { BookingStatusBadge, PaymentStatusBadge } from "@/components/portal/status-badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireWorkspace } from "@/lib/auth/session";
import { loadControlTower, parseTowerFilters } from "@/lib/control-tower/load";
import { eventTypeLabel, STATUS_GROUPS, violationLabel, type Breakdown } from "@/lib/control-tower/summary";
import { POLICY_STATUSES, EVENT_TYPES, type PolicyStatus } from "@/lib/policies/evaluate-booking-policy";
import type { BookingStatus, PaymentStatus } from "@/lib/supabase/database.types";
import { cn, formatDate, formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Control Tower" };

/** Rows shown on the page; the CSV has every match. */
const PAGE_ROWS = 100;

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);
const shortName = (legal: string) => legal.replace(/ Private Limited$| Pvt\.? Ltd\.?$/i, "");

/**
 * Control Tower: every event request across the company — policy outcome,
 * sign-off and payment — with compliance and spend by team and event type.
 * Finance and procurement's one view; admins can see every company.
 */
export default async function ControlTowerPage({ searchParams }: PageProps<"/control-tower">) {
  const member = await requireWorkspace("/control-tower");
  const params = await searchParams;
  const admin = member.role === "ADMIN";
  const filters = parseTowerFilters(params, admin ? null : member.companyId);
  const { rows, summary, deptName, options } = await loadControlTower(filters);

  const query = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" && v ? [[k, v]] : [])));
  const filtered = [...query.keys()].some((k) => ["company", "dept", "type", "city", "status", "from", "to"].includes(k));
  const stats = [
    { label: "Requests", value: String(summary.requests) },
    { label: "Committed spend", value: formatINR(summary.committedInr), hint: "Invoice totals with GST, for requests that went ahead or are under way" },
    { label: "Policy compliance", value: pct(summary.complianceRate), hint: `In-policy share of ${summary.policyAssessed} request${summary.policyAssessed === 1 ? "" : "s"} with a policy outcome`, warn: summary.complianceRate !== null && summary.complianceRate < 0.8 },
    { label: "Saved vs list", value: formatINR(summary.savingsInr), hint: "Rate cards and negotiation, against each venue's list price" },
    { label: "Awaiting sign-off", value: String(summary.awaitingSignoff), warn: summary.awaitingSignoff > 0 },
    { label: "Median sign-off time", value: summary.medianApprovalHours === null ? "—" : summary.medianApprovalHours < 24 ? `${summary.medianApprovalHours} h` : `${Math.round((summary.medianApprovalHours / 24) * 10) / 10} d` },
  ];
  const deptLabel = (key: string) => (key === "none" ? "No department" : (deptName.get(key) ?? "Unknown department"));
  const typeLabel = (key: string) => (key === "none" ? "Not recorded" : eventTypeLabel(key));

  return (
    <Page>
      <PageHeader
        title="Control Tower"
        description="Every event request in one place: what was spent, whether it was in policy, who signed it off, and whether it's paid. Filter by team, event type, city or period, then export for finance."
        badge={admin && !filters.companyId ? <NoticePill>all companies</NoticePill> : null}
      />

      <form method="get" className="panel mb-8 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 xl:items-end" aria-label="Filters">
        {admin ? (
          <Field label="Company">
            <NativeSelect name="company" defaultValue={filters.companyId ?? ""}>
              <option value="">All companies</option>
              {options.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {shortName(c.name)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        <Field label="Department">
          <NativeSelect name="dept" defaultValue={filters.departmentId ?? ""}>
            <option value="">All</option>
            {options.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
            {options.hasUnassignedDept ? <option value="none">No department</option> : null}
          </NativeSelect>
        </Field>
        <Field label="Event type">
          <NativeSelect name="type" defaultValue={filters.eventType ?? ""}>
            <option value="">All</option>
            {Object.entries(EVENT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
            <option value="none">Not recorded</option>
          </NativeSelect>
        </Field>
        <Field label="City">
          <NativeSelect name="city" defaultValue={filters.city ?? ""}>
            <option value="">All</option>
            {options.cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Status">
          <NativeSelect name="status" defaultValue={filters.status ?? ""}>
            <option value="">All</option>
            {Object.entries(STATUS_GROUPS).map(([k, g]) => (
              <option key={k} value={k}>
                {g.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Event from">
          <Input type="date" name="from" defaultValue={filters.from ?? ""} />
        </Field>
        <Field label="Event to">
          <Input type="date" name="to" defaultValue={filters.to ?? ""} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          {filtered ? (
            <Link href="/control-tower" className="btn h-9 px-3 text-meta">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <dl className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="panel p-5" title={s.hint}>
            <dt className="label-mono">{s.label}</dt>
            <dd className={cn("figure text-fg mt-1 text-section", s.warn && "text-warn")}>{s.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <section className="panel p-5" aria-labelledby="ct-policy">
          <h2 id="ct-policy" className="text-fg mb-3 text-body font-medium">
            Policy outcomes
          </h2>
          <ul className="grid gap-2">
            {POLICY_STATUSES.map((s) => (
              <li key={s} className="flex items-center justify-between gap-3 text-meta">
                <PolicyBadge status={s} />
                <span className="figure text-fg">{summary.policyCounts[s]}</span>
              </li>
            ))}
          </ul>
          {summary.topViolations.length ? (
            <>
              <h3 className="label-mono mt-5 mb-2">Most common breaches</h3>
              <ul className="grid gap-1.5">
                {summary.topViolations.map((v) => (
                  <li key={v.code} className="text-fg-muted flex justify-between gap-3 text-meta">
                    <span>{v.label}</span>
                    <span className="figure text-fg">{v.count}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
        <BreakdownTable id="ct-dept" title="By department" rows={summary.byDepartment} label={deptLabel} />
        <BreakdownTable id="ct-type" title="By event type" rows={summary.byEventType} label={typeLabel} />
      </div>

      <SectionLabel
        aside={
          rows.length ? (
            <a href={`/api/control-tower?${query.toString()}${query.size ? "&" : ""}format=csv`} download className="btn h-8 px-3 text-meta">
              <Download className="size-3.5" aria-hidden /> Export CSV
            </a>
          ) : null
        }
      >
        Requests{rows.length > PAGE_ROWS ? ` · latest ${PAGE_ROWS} of ${rows.length}` : ` · ${rows.length}`}
      </SectionLabel>
      <div className="panel overflow-x-auto">
        <Table className="min-w-[64rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              {admin && !filters.companyId ? <TableHead>Company</TableHead> : null}
              <TableHead>Requested by</TableHead>
              <TableHead>Department · type</TableHead>
              <TableHead className="text-right">Invoice total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Policy</TableHead>
              <TableHead>Payment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, PAGE_ROWS).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="py-3">
                  <div className="text-fg-subtle text-caption tabular-nums">{formatDate(r.event_date)}</div>
                  <div className="text-fg font-medium">{r.venue_name}</div>
                  <div className="text-fg-subtle text-caption">
                    {r.city} · {r.party_size} guests
                  </div>
                </TableCell>
                {admin && !filters.companyId ? <TableCell className="text-fg-muted">{shortName(r.company_name)}</TableCell> : null}
                <TableCell className="text-fg-muted">{r.requester_name ?? "—"}</TableCell>
                <TableCell>
                  <div className="text-fg-muted">{r.department_name ?? "No department"}</div>
                  <div className="text-fg-subtle text-caption">{eventTypeLabel(r.event_type)}</div>
                  {r.cost_center ? <div className="text-fg-subtle font-mono text-caption">{r.cost_center}</div> : null}
                </TableCell>
                <TableCell className="text-fg text-right font-mono tabular-nums">{formatINR(r.invoice_total_inr)}</TableCell>
                <TableCell>
                  <BookingStatusBadge status={r.status as BookingStatus} audience="client" />
                </TableCell>
                <TableCell>
                  {r.policy_status && r.policy_status in POLICY_STATUS_META ? (
                    <PolicyBadge status={r.policy_status as PolicyStatus} reason={r.policy_violation_reasons.length ? r.policy_violation_reasons.map(violationLabel).join(", ") : undefined} />
                  ) : (
                    <span className="text-fg-faint text-caption">Not assessed</span>
                  )}
                </TableCell>
                <TableCell>{r.payment_status ? <PaymentStatusBadge status={r.payment_status as PaymentStatus} /> : <span className="text-fg-faint text-caption">—</span>}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-fg-subtle py-10 text-center">
                  {filtered ? "No requests match these filters." : "No event requests yet."}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </Page>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-meta">
      <span className="text-fg-subtle">{label}</span>
      {children}
    </label>
  );
}

function BreakdownTable({ id, title, rows, label }: { id: string; title: string; rows: Breakdown[]; label: (key: string) => string }) {
  return (
    <section className="panel p-5" aria-labelledby={id}>
      <h2 id={id} className="text-fg mb-3 text-body font-medium">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-fg-subtle text-meta">Nothing yet.</p>
      ) : (
        <table className="w-full text-meta">
          <thead>
            <tr className="text-fg-subtle text-left">
              <th scope="col" className="pb-2 font-normal">
                <span className="sr-only">{title.replace("By ", "")}</span>
              </th>
              <th scope="col" className="pb-2 text-right font-normal">
                Requests
              </th>
              <th scope="col" className="pb-2 text-right font-normal">
                Committed
              </th>
              <th scope="col" className="pb-2 text-right font-normal">
                In policy
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 8).map((r) => (
              <tr key={r.key} className="border-line border-t">
                <td className="text-fg-muted max-w-40 truncate py-1.5 pr-2">{label(r.key)}</td>
                <td className="figure text-fg py-1.5 text-right">{r.requests}</td>
                <td className="figure text-fg py-1.5 text-right">{formatINR(r.committedInr)}</td>
                <td className={cn("figure py-1.5 text-right", r.complianceRate !== null && r.complianceRate < 0.8 ? "text-warn" : "text-fg")}>{pct(r.complianceRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
