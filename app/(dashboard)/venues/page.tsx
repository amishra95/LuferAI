import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronLeft, ChevronRight, Database, Minus, Search } from "lucide-react";

import { NoticePill, PageHeader } from "@/components/dashboard/page-header";
import { dataSource, listVenues } from "@/lib/data";
import { formatINR, cn } from "@/lib/utils";
import { applyVenueQuery, PAGE_SIZES, parseVenueQuery, venueHref, type VenueQuery, type VenueSortKey } from "@/lib/venues/query";

export const metadata: Metadata = { title: "Venues" };

const COLUMNS: { key: VenueSortKey | null; label: string; align?: "right" }[] = [
  { key: "name", label: "Venue" },
  { key: "neighborhood", label: "Area" },
  { key: "capacity_max", label: "Capacity", align: "right" },
  { key: "min_spend_inr", label: "Min spend", align: "right" },
  { key: null, label: "PDR" },
  { key: "commission_rate", label: "Commission", align: "right" },
  { key: null, label: "GSTIN" },
];

const field =
  "h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none";

function SortHeader({ column, query }: { column: (typeof COLUMNS)[number]; query: VenueQuery }) {
  if (!column.key) return <>{column.label}</>;
  const active = query.sort === column.key;
  const nextDir = active && query.dir === "asc" ? "desc" : "asc";
  const Icon = !active ? ArrowUpDown : query.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Link
      href={venueHref(query, { sort: column.key, dir: nextDir, page: 1 })}
      scroll={false}
      className={cn("inline-flex items-center gap-1 hover:text-zinc-200", active && "text-zinc-200", column.align === "right" && "flex-row-reverse")}
      aria-label={`Sort by ${column.label} ${nextDir === "asc" ? "ascending" : "descending"}`}
    >
      {column.label}
      <Icon className={cn("size-3", !active && "opacity-40")} aria-hidden />
    </Link>
  );
}

export default async function VenuesPage({ searchParams }: PageProps<"/venues">) {
  const query = parseVenueQuery(await searchParams);
  const venues = await listVenues();
  const { rows, total, page, pageCount } = applyVenueQuery(venues, query);
  const areas = [...new Set(venues.map((v) => v.neighborhood))].sort();
  const source = dataSource();
  const filtered = query.q || query.area || query.pdr || query.minCapacity;
  const first = total === 0 ? 0 : (page - 1) * query.size + 1;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Venues"
        description="The catalogue the chat agent's searchVenues tool queries. Active venues only."
        badge={source === "mock" ? <NoticePill>Mock data</NoticePill> : <NoticePill tone="zinc">Supabase</NoticePill>}
      />

      <section className="mt-6 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60">
        {/* GET form: filters live in the URL, so views are shareable and work without JS. */}
        <form className="flex flex-wrap items-end gap-2 border-b border-zinc-800 p-3" role="search">
          <label className="relative min-w-48 flex-1">
            <span className="sr-only">Search venues</span>
            <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-zinc-500" aria-hidden />
            <input name="q" defaultValue={query.q} placeholder="Name, address or GSTIN" className={cn(field, "w-full pl-8")} />
          </label>
          <label>
            <span className="sr-only">Area</span>
            <select name="area" defaultValue={query.area} className={field}>
              <option value="">All areas</option>
              {areas.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Private dining room</span>
            <select name="pdr" defaultValue={query.pdr} className={field}>
              <option value="">Any PDR</option>
              <option value="yes">Has PDR</option>
              <option value="no">No PDR</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            Min guests
            <input name="min" type="number" min={0} defaultValue={query.minCapacity || ""} className={cn(field, "w-20 font-mono")} />
          </label>
          {query.sort !== "name" && <input type="hidden" name="sort" value={query.sort} />}
          {query.dir !== "asc" && <input type="hidden" name="dir" value={query.dir} />}
          {query.size !== 10 && <input type="hidden" name="size" value={query.size} />}
          <button type="submit" className="h-8 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-900 hover:bg-white">
            Apply
          </button>
          {filtered ? (
            <Link href={venueHref({ ...query, q: "", area: "", pdr: "", minCapacity: 0, page: 1 })} className="h-8 rounded-md px-2 text-xs leading-8 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
              Clear
            </Link>
          ) : null}
        </form>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/60 font-mono text-[11px] tracking-wider text-zinc-500 uppercase">
                {COLUMNS.map((c) => (
                  <th
                    key={c.label}
                    scope="col"
                    aria-sort={c.key && query.sort === c.key ? (query.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn("px-3 py-2 font-normal", c.align === "right" ? "text-right" : "text-left")}
                  >
                    <SortHeader column={c} query={query} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {rows.map((v) => (
                <tr key={v.id} className="transition-colors hover:bg-zinc-900">
                  <td className="max-w-80 px-3 py-2">
                    <p className="truncate text-zinc-100">{v.name}</p>
                    <p className="truncate text-xs text-zinc-500" title={v.address}>
                      {v.address}
                    </p>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-300">
                    {v.neighborhood}
                    <span className="text-zinc-600"> · {v.city}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-200 tabular-nums">{v.capacity_max}</td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-200 tabular-nums">{formatINR(Number(v.min_spend_inr))}</td>
                  <td className="px-3 py-2">
                    {v.pdr_available ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                        <Check className="size-3.5" aria-hidden /> Yes
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                        <Minus className="size-3.5" aria-hidden /> No
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-300 tabular-nums">{(Number(v.commission_rate) * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400">{v.gstin}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-3 py-12 text-center">
                    <Database className="mx-auto size-5 text-zinc-600" aria-hidden />
                    <p className="mt-2 text-sm text-zinc-400">No venues match these filters.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <footer className="flex flex-wrap items-center gap-3 border-t border-zinc-800 px-3 py-2 text-xs text-zinc-500">
          <span className="font-mono tabular-nums">
            {first}–{first ? first + rows.length - 1 : 0} of {total}
            {filtered ? ` (filtered from ${venues.length})` : ""}
          </span>
          <nav className="ml-auto flex items-center gap-1" aria-label="Pagination">
            <span className="mr-2 hidden sm:inline">Rows</span>
            {PAGE_SIZES.map((s) => (
              <Link
                key={s}
                href={venueHref(query, { size: s, page: 1 })}
                scroll={false}
                aria-current={s === query.size ? "true" : undefined}
                className={cn("rounded px-1.5 py-0.5 font-mono hover:bg-zinc-800 hover:text-zinc-200", s === query.size && "bg-zinc-800 text-zinc-100")}
              >
                {s}
              </Link>
            ))}
            <span className="mx-2 h-4 w-px bg-zinc-800" aria-hidden />
            <PageLink query={query} page={page - 1} disabled={page <= 1} label="Previous page">
              <ChevronLeft className="size-4" aria-hidden />
            </PageLink>
            <span className="px-1 font-mono tabular-nums">
              {page} / {pageCount}
            </span>
            <PageLink query={query} page={page + 1} disabled={page >= pageCount} label="Next page">
              <ChevronRight className="size-4" aria-hidden />
            </PageLink>
          </nav>
        </footer>
      </section>
    </div>
  );
}

function PageLink({ query, page, disabled, label, children }: { query: VenueQuery; page: number; disabled: boolean; label: string; children: React.ReactNode }) {
  const cls = "grid size-7 place-items-center rounded-md border border-zinc-800";
  if (disabled) {
    return (
      <span aria-disabled className={cn(cls, "text-zinc-700")}>
        {children}
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <Link href={venueHref(query, { page })} scroll={false} aria-label={label} className={cn(cls, "text-zinc-300 hover:bg-zinc-800")}>
      {children}
    </Link>
  );
}
