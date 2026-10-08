import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";

import { NoticePill, Page, PageHeader } from "@/components/dashboard/page-header";
import { dataSource } from "@/lib/data";
import { listDirectory } from "@/lib/venues/directory";
import { cn, formatINR } from "@/lib/utils";
import { applyVenueQuery, PAGE_SIZES, parseVenueQuery, venueHref, type VenueQuery, type VenueSortKey } from "@/lib/venues/query";

export const metadata: Metadata = { title: "Venues" };

const COLUMNS: { key: VenueSortKey | null; label: string; align?: "right"; className?: string }[] = [
  { key: "name", label: "Venue" },
  { key: null, label: "Tier" },
  { key: "neighborhood", label: "Area" },
  { key: "capacity_max", label: "Guests", align: "right" },
  { key: "min_spend_inr", label: "Min spend", align: "right" },
  { key: null, label: "PDR", className: "text-center" },
  { key: "commission_rate", label: "Comm.", align: "right" },
  { key: null, label: "GSTIN", className: "hidden xl:table-cell" },
];

function SortHeader({ column, query }: { column: (typeof COLUMNS)[number]; query: VenueQuery }) {
  if (!column.key) return <>{column.label}</>;
  const active = query.sort === column.key;
  const nextDir = active && query.dir === "asc" ? "desc" : "asc";
  const Icon = query.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Link
      href={venueHref(query, { sort: column.key, dir: nextDir, page: 1 })}
      scroll={false}
      className={cn("hover:text-fg inline-flex items-center gap-1 transition-colors", active && "text-fg", column.align === "right" && "flex-row-reverse")}
      aria-label={`Sort by ${column.label} ${nextDir === "asc" ? "ascending" : "descending"}`}
    >
      {column.label}
      {active && <Icon className="text-copper-deep size-3" aria-hidden />}
    </Link>
  );
}

export default async function VenuesPage({ searchParams }: PageProps<"/venues">) {
  const query = parseVenueQuery(await searchParams);
  const { venues, partners } = await listDirectory();
  const { rows, total, page, pageCount } = applyVenueQuery(venues, query);
  const areas = [...new Set(venues.map((v) => v.neighborhood))].sort();
  const source = dataSource();
  const filtered = Boolean(query.q || query.tier || query.area || query.pdr || query.minCapacity);
  const first = total === 0 ? 0 : (page - 1) * query.size + 1;

  return (
    <Page>
      <PageHeader
        title="Venues"
        description="Lufer.ai's own venues plus federated partner listings — the directory the agent's searchVenues tool queries."
        badge={<NoticePill>{source === "mock" ? "mock data" : source}</NoticePill>}
      />

      {/* GET form: filters live in the URL, so views are shareable and work without JS. */}
      <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <label className="relative min-w-56 flex-[2_1_16rem]">
          <span className="sr-only">Search venues</span>
          <Search className="text-fg-faint pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" aria-hidden />
          <input name="q" defaultValue={query.q} placeholder="Search name, address or GSTIN" className="field pl-9" />
        </label>
        <label className="flex-[1_1_9rem]">
          <span className="sr-only">Area</span>
          <select name="area" defaultValue={query.area} className="field">
            <option value="">All areas</option>
            {areas.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="flex-[1_1_9rem]">
          <span className="sr-only">Directory tier</span>
          <select name="tier" defaultValue={query.tier} className="field">
            <option value="">All tiers</option>
            <option value="internal">Lufer.ai venues</option>
            <option value="partner">Partner network</option>
          </select>
        </label>
        <label className="flex-[1_1_8rem]">
          <span className="sr-only">Private dining room</span>
          <select name="pdr" defaultValue={query.pdr} className="field">
            <option value="">Any PDR</option>
            <option value="yes">With PDR</option>
            <option value="no">Without PDR</option>
          </select>
        </label>
        <label className="flex-[0_1_7.5rem]">
          <span className="sr-only">Minimum guests</span>
          <input name="min" type="number" min={0} defaultValue={query.minCapacity || ""} placeholder="Min guests" className="field font-mono" />
        </label>
        {query.sort !== "name" && <input type="hidden" name="sort" value={query.sort} />}
        {query.dir !== "asc" && <input type="hidden" name="dir" value={query.dir} />}
        {query.size !== 10 && <input type="hidden" name="size" value={query.size} />}
        <div className="flex gap-1">
          <button type="submit" className="btn btn-primary h-9 rounded-[10px]">
            Apply
          </button>
          {filtered && (
            <Link href={venueHref({ ...query, q: "", tier: "", area: "", pdr: "", minCapacity: 0, page: 1 })} className="btn btn-ghost h-9">
              Reset
            </Link>
          )}
        </div>
      </form>

      {partners.status === "unavailable" && (
        <p role="status" className="border-line bg-surface text-fg-subtle mb-3 rounded-xl border px-4 py-2.5 text-[12.5px]">
          {partners.network} is unavailable right now ({partners.error}). Showing Lufer.ai venues only.
        </p>
      )}

      <section className="panel overflow-hidden">
        {/* Phones: stacked rows. The full table starts at md. */}
        <ul className="md:hidden">
          {rows.map((v) => (
            <li key={v.id} className="border-line border-b px-4 py-3.5 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-fg truncate text-[13.5px] font-medium">{v.name}</p>
                <p className="text-fg shrink-0 font-mono text-[12.5px] tabular-nums">{formatINR(v.min_spend_inr)}</p>
              </div>
              <p className="text-fg-subtle mt-1 flex flex-wrap gap-x-3 font-mono text-[11.5px] tabular-nums">
                <span className="text-fg-muted font-sans text-[12.5px]">{v.neighborhood}</span>
                <span>{v.capacity_max} guests</span>
                <span>{v.pdr_available ? "PDR" : "no PDR"}</span>
                {v.tier === "partner" ? <span>partner · {v.supplier}</span> : <span>{(Number(v.commission_rate) * 100).toFixed(1)}%</span>}
              </p>
            </li>
          ))}
          {rows.length === 0 && <li className="text-fg-muted px-4 py-12 text-center text-[13.5px]">No venues match these filters.</li>}
        </ul>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[46rem] text-[13px]">
            <thead>
              <tr className="border-line border-b">
                {COLUMNS.map((c) => (
                  <th
                    key={c.label}
                    scope="col"
                    aria-sort={c.key && query.sort === c.key ? (query.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn("label-mono h-10 px-4 font-medium first:pl-5 last:pr-5", c.align === "right" ? "text-right" : "text-left", c.className)}
                  >
                    <SortHeader column={c} query={query} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-line hover:bg-surface-hover border-b transition-colors last:border-b-0">
                  <td className="max-w-80 py-3 pr-4 pl-5">
                    <p className="text-fg truncate font-medium">{v.name}</p>
                    <p className="text-fg-subtle mt-0.5 truncate text-[12px]" title={v.address}>
                      {v.address}
                    </p>
                  </td>
                  <td className="px-4">
                    <TierBadge venue={v} />
                  </td>
                  <td className="text-fg-muted px-4 whitespace-nowrap">{v.neighborhood}</td>
                  <td className="text-fg px-4 text-right font-mono tabular-nums">{v.capacity_max}</td>
                  <td className="text-fg px-4 text-right font-mono tabular-nums">{formatINR(v.min_spend_inr)}</td>
                  <td className="px-4 text-center">
                    {v.pdr_available ? (
                      <span className="bg-sage inline-block size-1.5 rounded-full" title="Private dining room" />
                    ) : (
                      <span className="text-fg-faint font-mono">–</span>
                    )}
                    <span className="sr-only">{v.pdr_available ? "Yes" : "No"}</span>
                  </td>
                  <td className="text-fg-muted px-4 text-right font-mono tabular-nums">
                    {v.commission_rate === null ? <span className="text-fg-faint">—</span> : `${(v.commission_rate * 100).toFixed(1)}%`}
                  </td>
                  <td className="text-fg-subtle hidden pr-5 pl-4 font-mono text-[12px] xl:table-cell">{v.gstin ?? <span className="text-fg-faint">—</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-5 py-16 text-center">
                    <p className="text-fg-muted text-[13.5px]">No venues match these filters.</p>
                    <Link href="/venues" className="text-fg-subtle hover:text-copper-ink mt-1 inline-block text-[12.5px] transition-colors">
                      Clear filters
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <footer className="border-line text-fg-subtle flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-5 py-2.5 font-mono text-[11.5px]">
          <span className="tabular-nums">
            {first}–{first ? first + rows.length - 1 : 0} of {total}
            {filtered && <span className="text-fg-subtle"> · filtered from {venues.length}</span>}
          </span>
          <nav className="ml-auto flex items-center gap-3" aria-label="Pagination">
            <span className="flex items-center gap-0.5">
              <span className="text-fg-subtle mr-1.5 hidden sm:inline">rows</span>
              {PAGE_SIZES.map((s) => (
                <Link
                  key={s}
                  href={venueHref(query, { size: s, page: 1 })}
                  scroll={false}
                  aria-current={s === query.size ? "true" : undefined}
                  className={cn("hover:text-fg rounded-md px-1.5 py-0.5 transition-colors", s === query.size && "bg-surface-raised text-fg")}
                >
                  {s}
                </Link>
              ))}
            </span>
            <span className="flex items-center gap-1">
              <PageLink query={query} page={page - 1} disabled={page <= 1} label="Previous page">
                <ChevronLeft className="size-3.5" aria-hidden />
              </PageLink>
              <span className="text-fg-muted min-w-10 text-center tabular-nums">
                {page}/{pageCount}
              </span>
              <PageLink query={query} page={page + 1} disabled={page >= pageCount} label="Next page">
                <ChevronRight className="size-3.5" aria-hidden />
              </PageLink>
            </span>
          </nav>
        </footer>
      </section>
    </Page>
  );
}

function PageLink({ query, page, disabled, label, children }: { query: VenueQuery; page: number; disabled: boolean; label: string; children: React.ReactNode }) {
  if (disabled) {
    return (
      <span aria-disabled="true" className="btn btn-icon size-7 rounded-lg">
        {children}
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <Link href={venueHref(query, { page })} scroll={false} aria-label={label} className="btn btn-icon size-7 rounded-lg">
      {children}
    </Link>
  );
}

function TierBadge({ venue }: { venue: { tier: "internal" | "partner"; supplier: string | null } }) {
  if (venue.tier === "internal") {
    return (
      <span className="pill" title="Lufer.ai venue: book directly">
        <span className="bg-fg size-1.5 rounded-full" aria-hidden /> Lufer.ai
      </span>
    );
  }
  return (
    <span className="pill" title={`Partner venue listed by ${venue.supplier}; booked through the supplier`}>
      <span className="border-fg-subtle size-1.5 rounded-full border" aria-hidden /> partner
    </span>
  );
}
