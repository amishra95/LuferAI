import { multiplierFor, WEEKDAY_LABEL, type RateMultiplier } from "@/lib/rates/venue-pricing";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The next `weeks` weeks (Monday first) with the multiplier each day gets, so a
 * host sees how weekend, peak-season and high-demand rates land together.
 * Blocked dates are struck through: they can't be booked at any rate.
 */
export function RateCalendar({ today, multipliers, blocked, weeks = 8 }: { today: string; multipliers: RateMultiplier[]; blocked: Set<string>; weeks?: number }) {
  const start = Date.parse(`${today}T00:00:00Z`);
  const offset = (new Date(start).getUTCDay() + 6) % 7; // days since Monday
  const days = Array.from({ length: weeks * 7 }, (_, i) => iso(start + (i - offset) * DAY_MS));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const monthOf = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] table-fixed border-separate border-spacing-1 text-center" aria-label={`Rates for the next ${weeks} weeks`}>
        <thead>
          <tr>
            {order.map((d) => (
              <th key={d} scope="col" className="label-mono pb-1 font-normal">
                {WEEKDAY_LABEL[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: weeks }, (_, w) => (
            <tr key={w}>
              {days.slice(w * 7, w * 7 + 7).map((d) => {
                const past = d < today;
                const { multiplier, rule } = multiplierFor(multipliers, d);
                const isBlocked = blocked.has(d);
                const day = Number(d.slice(8));
                return (
                  <td
                    key={d}
                    title={isBlocked ? `${d}: blocked` : rule ? `${d}: ${rule.label} ×${multiplier}` : `${d}: standard rate`}
                    className={cn(
                      "rounded-md px-0.5 py-1.5 align-top text-[12px] tabular-nums",
                      past ? "text-fg-faint" : "text-fg-muted",
                      !past && multiplier > 1 && "bg-warn/10 text-fg",
                      !past && multiplier > 1.3 && "bg-warn/20",
                      !past && multiplier < 1 && "bg-sage/10 text-fg",
                      d === today && "ring-fg/40 ring-1"
                    )}
                  >
                    <span className={cn("block", isBlocked && "line-through")}>
                      {day === 1 || d === days[0] ? `${day} ${monthOf(d)}` : day}
                    </span>
                    <span className="block font-mono text-[10.5px]">{!past && !isBlocked && multiplier !== 1 ? `×${multiplier}` : " "}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
