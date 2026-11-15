/**
 * A BillDocument (lib/finance/tax-invoice-document.ts) as an A4 PDF, for the
 * invoice email and the download links. Laid out from the same model as the
 * HTML page, so the two always say the same thing.
 *
 * Uses the PDF's built-in Helvetica, which has no rupee sign: amounts print as
 * "Rs. 1,18,000.00". Characters the font can't draw become "?".
 *
 * Pure (no path aliases): tests import it directly.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { BillDocument } from "./tax-invoice-document.ts";

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 51; // 18mm
const INK = rgb(0.11, 0.1, 0.09);
const MUTED = rgb(0.34, 0.33, 0.31);
const RULE = rgb(0.91, 0.9, 0.89);

/** Text the standard font can encode (WinAnsi). */
export function pdfText(s: string): string {
  return s
    .replace(/₹\s?/g, "Rs. ")
    .replace(/[−–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E¡-ÿ]/g, "?")
    .trim();
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function renderDocumentPdf(doc: BillDocument, opts: { createdAt?: Date } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Fixed metadata, so the same document gives the same file.
  const stamp = opts.createdAt ?? new Date(0);
  pdf.setTitle(pdfText(doc.title));
  pdf.setProducer("Lufer");
  pdf.setCreator("Lufer");
  pdf.setCreationDate(stamp);
  pdf.setModificationDate(stamp);

  const contentWidth = A4.width - MARGIN * 2;
  let page: PDFPage = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;
  const room = (needed: number) => {
    if (y - needed < MARGIN) {
      page = pdf.addPage([A4.width, A4.height]);
      y = A4.height - MARGIN;
    }
  };
  const text = (s: string, x: number, size: number, font = regular, color = INK) => page.drawText(s, { x, y, size, font, color });
  /** Wrapped paragraph at the left margin; moves y below it. */
  const paragraph = (s: string, size: number, font = regular, color = INK, width = contentWidth, x = MARGIN) => {
    for (const line of wrap(pdfText(s), font, size, width)) {
      room(size * 1.45);
      y -= size * 1.45;
      text(line, x, size, font, color);
    }
  };

  // Heading and meta
  y -= 18;
  text(pdfText(doc.heading), MARGIN, 18, bold);
  y -= 6;
  paragraph(doc.meta.join("  ·  "), 8.5, regular, MUTED);
  y -= 18;

  // Parties, side by side
  const colWidth = (contentWidth - 20) / 2;
  const top = y;
  let lowest = y;
  doc.parties.slice(0, 2).forEach((p, i) => {
    const x = MARGIN + i * (colWidth + 20);
    y = top;
    y -= 10;
    text(pdfText(p.heading).toUpperCase(), x, 7.5, regular, MUTED);
    y -= 3;
    p.lines.forEach((line, n) => paragraph(line, 10, n === 0 ? bold : regular, INK, colWidth, x));
    lowest = Math.min(lowest, y);
  });
  y = lowest - 22;

  // Table: the first column takes the slack; number columns are right-aligned.
  const cols = doc.columns;
  const narrow: number[] = cols.map((c, i) => (i === 0 ? 0 : c.num ? (i === cols.length - 1 ? 105 : 45) : 70));
  const first = contentWidth - narrow.reduce((a, b) => a + b, 0);
  const widths = cols.map((_, i) => (i === 0 ? first : narrow[i]));
  const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const cell = (s: string, i: number, size: number, font: PDFFont, color = INK) => {
    const t = pdfText(s);
    const x = cols[i].num ? xs[i] + widths[i] - font.widthOfTextAtSize(t, size) : xs[i];
    text(t, x, size, font, color);
  };

  y -= 9;
  cols.forEach((c, i) => cell(c.label, i, 8.5, regular, MUTED));
  y -= 6;
  for (const r of doc.rows) {
    const font = r.total ? bold : regular;
    const firstLines = wrap(pdfText(r.cells[0] ?? ""), font, 10, widths[0] - 8);
    const height = firstLines.length * 13 + 9;
    room(height);
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + contentWidth, y }, thickness: r.total ? 1.2 : 0.6, color: r.total ? INK : RULE });
    y -= 15;
    const rowTop = y;
    firstLines.forEach((line, n) => {
      y = rowTop - n * 13;
      text(line, xs[0], 10, font);
    });
    y = rowTop;
    r.cells.slice(1).forEach((c, n) => cell(c, n + 1, 10, font));
    y = rowTop - (firstLines.length - 1) * 13 - 7;
  }
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + contentWidth, y }, thickness: 0.6, color: RULE });

  if (doc.words) {
    y -= 8;
    paragraph(`Amount in words: ${doc.words}`, 10);
  }
  for (const note of doc.notes) {
    y -= 10;
    paragraph(note, 8.5, regular, MUTED);
  }
  if (doc.signFor) {
    room(70);
    y -= 44;
    const forLine = pdfText(`For ${doc.signFor}`);
    text(forLine, MARGIN + contentWidth - regular.widthOfTextAtSize(forLine, 10), 10);
    y -= 14;
    const sig = "Authorised signatory";
    text(sig, MARGIN + contentWidth - regular.widthOfTextAtSize(sig, 10), 10);
  }
  if (doc.footer) {
    y -= 14;
    paragraph(doc.footer, 8.5, regular, MUTED);
  }

  return pdf.save({ useObjectStreams: false });
}

/** A safe file name for a document: "Tax-Invoice-2026-27-000001.pdf". */
export const documentFilename = (doc: Pick<BillDocument, "title">, ext: "pdf" | "html") =>
  `${pdfText(doc.title).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")}.${ext}`;
