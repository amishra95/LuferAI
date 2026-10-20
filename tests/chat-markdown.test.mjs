/**
 * Chat markdown (components/chat/markdown.tsx): the plugins it renders with turn
 * the table shapes models produce into real HTML tables.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { remarkBreaks } from "../components/chat/remark-breaks.ts";

const render = (md) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkBreaks] }, md));
const rows = (html) => (html.match(/<tr>/g) ?? []).length;

test("pipe tables render as tables, whatever surrounds them", () => {
  const shapes = {
    blankLineBefore: "Spend by month:\n\n| Month | Spend |\n|---|---|\n| Apr | ₹1,20,000 |\n| May | ₹90,000 |",
    noBlankLineBefore: "Spend by month:\n| Month | Spend |\n|---|---|\n| Apr | ₹1,20,000 |\n| May | ₹90,000 |",
    noOuterPipes: "Month | Spend\n--- | ---\nApr | ₹1,20,000\nMay | ₹90,000",
    windowsLineEndings: "| Month | Spend |\r\n|---|---|\r\n| Apr | ₹1,20,000 |\r\n| May | ₹90,000 |",
  };
  for (const [name, md] of Object.entries(shapes)) {
    const html = render(md);
    assert.match(html, /<table>/, name);
    assert.equal(rows(html), 3, `${name}: header + 2 rows`);
    assert.match(html, /<th>Month<\/th>/, name);
    assert.doesNotMatch(html, /\|/, `${name}: no stray pipes`);
  }
});

test("a sentence before the table stays a paragraph", () => {
  assert.match(render("Spend by month:\n| Month | Spend |\n|---|---|\n| Apr | 1 |"), /^<p>Spend by month:<\/p>\s*<table>/);
});

test("column alignment carries through", () => {
  const html = render("| Item | Amount |\n|:---|---:|\n| GST | ₹9,000 |");
  assert.match(html, /<td style="text-align:right">₹9,000<\/td>/);
  assert.match(html, /<th style="text-align:left">Item<\/th>/);
});

test("<br> inside a cell becomes a line break; other HTML stays text", () => {
  const html = render("| Venue | Notes |\n|---|---|\n| Toit | Rooftop<br>Live music<BR/>Late |\n| Byg | <b>bold</b> |");
  assert.match(html, /<td>Rooftop<br\/>\s*Live music<br\/>\s*Late<\/td>/);
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>/);
});

test("while streaming, a table appears once its separator row is complete", () => {
  assert.doesNotMatch(render("| Month | Spend |\n|---|"), /<table>/);
  assert.match(render("| Month | Spend |\n|---|---|"), /<table>/);
});
