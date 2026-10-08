/**
 * Command-palette matching. Every query word must appear somewhere in the item's
 * text; items rank higher when words start a word in the title. Pure, so it's
 * unit tested (tests/command-search.test.mjs).
 */

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Score for `query` against an item, or null when it doesn't match. Higher is better. */
export function matchScore(query: string, title: string, keywords = ""): number | null {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const t = norm(title);
  const hay = `${t} ${norm(keywords)}`;
  let score = 0;
  for (const w of words) {
    const at = hay.indexOf(w);
    if (at === -1) return null;
    if (t.startsWith(w)) score += 4;
    else if (new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t)) score += 3;
    else if (at < t.length) score += 2;
    else score += 1;
  }
  return score;
}

/** Items matching `query`, best first; ties keep their original order. */
export function rankMatches<T>(items: T[], query: string, text: (item: T) => { title: string; keywords?: string }, limit = Infinity): T[] {
  return items
    .map((item, i) => {
      const { title, keywords } = text(item);
      return { item, i, score: matchScore(query, title, keywords) };
    })
    .filter((x): x is { item: T; i: number; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item);
}
