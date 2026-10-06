import { Fragment } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Renders the comparison matrix produced by lib/quotes buildComparisonMatrix().
 * It only understands that generator's output (a lead paragraph plus one pipe
 * table with **bold** spans), so what the page shows is exactly the Markdown
 * the API returns.
 */
const splitRow = (line: string) =>
  line
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

function Inline({ text }: { text: string }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
    chunk.startsWith("**") && chunk.endsWith("**") ? (
      <strong key={i}>{chunk.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{chunk.replace(/^_(.*)_$/, "$1")}</Fragment>
    )
  );
}

export function MarkdownMatrix({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const tableStart = lines.findIndex((l) => l.startsWith("|"));
  const intro = (tableStart === -1 ? lines : lines.slice(0, tableStart)).filter((l) => l.trim());
  const [header, , ...rows] = tableStart === -1 ? [] : lines.slice(tableStart).filter((l) => l.startsWith("|"));

  return (
    <div className="grid gap-3">
      {intro.map((l, i) => (
        <p key={i} className="text-sm">
          <Inline text={l} />
        </p>
      ))}
      {header ? (
        <Table>
          <TableHeader>
            <TableRow>
              {splitRow(header).map((c, i) => (
                <TableHead key={i} className={i === 0 ? "w-36" : undefined}>
                  <Inline text={c} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, r) => (
              <TableRow key={r}>
                {splitRow(row).map((c, i) => (
                  <TableCell key={i} className={i === 0 ? "text-muted-foreground" : "tabular-nums"}>
                    <Inline text={c} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
