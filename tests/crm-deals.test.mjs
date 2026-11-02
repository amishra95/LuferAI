// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";

import { dealRoi, normaliseStage, parseAmount, parseCsv, parseDate, parseDealsCsv } from "../lib/crm/deals.ts";

test("CSV parser: quotes, doubled quotes, CRLF, BOM, blank lines", () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\n1,\n'), [
    ["a", "b"],
    ["x, y", 'say "hi"'],
    ["1", ""],
  ]);
  assert.deepEqual(parseCsv('a,"multi\nline"'), [["a", "multi\nline"]]);
});

test("field parsers", () => {
  assert.equal(normaliseStage("Closed Won"), "won");
  assert.equal(normaliseStage("closedwon"), "won");
  assert.equal(normaliseStage("Closed (Lost)"), "lost");
  assert.equal(normaliseStage("Closed Lost to Competition"), "lost");
  assert.equal(normaliseStage("Negotiation/Review"), "open");
  assert.equal(normaliseStage(""), "open");
  assert.equal(parseAmount("₹ 12,50,000.00"), 1250000);
  assert.equal(parseAmount("INR 5000"), 5000);
  assert.equal(parseAmount(""), 0);
  assert.ok(Number.isNaN(parseAmount("TBD")));
  assert.equal(parseDate("2026-10-31"), "2026-10-31");
  assert.equal(parseDate("2026-10-31 14:00"), "2026-10-31");
  assert.equal(parseDate("05/10/2026"), "2026-10-05"); // DD/MM/YYYY
  assert.equal(parseDate("someday"), null);
});

test("Zoho CRM export", () => {
  const csv = `Record Id,Deal Name,Account Name,Amount,Stage,Closing Date,Deal Owner
zcrm_1,Infosys renewal,Infosys,"12,50,000",Closed Won,31/10/2026,priya@acme.in
zcrm_2,Wipro pilot,Wipro,400000,Negotiation/Review,15/12/2026,
zcrm_3,TCS expansion,TCS,900000,Closed Lost,02/10/2026,Rahul`;
  const r = parseDealsCsv(csv);
  assert.equal(r.provider, "zoho");
  assert.deepEqual(r.errors, []);
  assert.equal(r.deals.length, 3);
  assert.deepEqual(r.deals[0], { provider: "zoho", external_id: "zcrm_1", name: "Infosys renewal", account_name: "Infosys", amount_inr: 1250000, stage: "won", closed_on: "2026-10-31", owner_email: "priya@acme.in" });
  assert.equal(r.deals[1].closed_on, null); // open deals carry no close date
  assert.equal(r.deals[2].owner_email, null); // a name, not an email
});

test("HubSpot and Salesforce exports are detected", () => {
  assert.equal(parseDealsCsv("Record ID,Deal Name,Deal Stage,Amount,Close Date\n1,A,closedwon,100,2026-10-01").provider, "hubspot");
  const sf = parseDealsCsv("Opportunity ID,Opportunity Name,Account Name,Stage,Amount,Close Date\n006A,Big deal,Acme,Closed Won,100,2026-10-01");
  assert.equal(sf.provider, "salesforce");
  assert.equal(sf.deals[0].stage, "won");
});

test("bad rows are reported, not imported", () => {
  const r = parseDealsCsv("Deal ID,Deal Name,Amount\n1,A,100\n,No id,5\n1,Dup,5\n2,B,TBD\n3,C,");
  assert.deepEqual(r.deals.map((d) => d.external_id), ["1", "3"]);
  assert.deepEqual(r.errors.map((e) => e.line), [3, 4, 5]);
  assert.match(parseDealsCsv("Amount,Stage\n1,won").errors[0].error, /Missing columns/);
  assert.match(parseDealsCsv("").errors[0].error, /empty/);
});

test("ROI: spend per deal, won revenue per rupee, win rate vs baseline", () => {
  const deals = [
    { id: "d1", name: "Infosys", account_name: null, amount_inr: 1000000, stage: "won", closed_on: "2026-10-31" },
    { id: "d2", name: "Wipro", account_name: null, amount_inr: 400000, stage: "open", closed_on: null },
    { id: "d3", name: "TCS", account_name: null, amount_inr: 900000, stage: "lost", closed_on: "2026-10-02" },
    { id: "d4", name: "HCL", account_name: null, amount_inr: 200000, stage: "lost", closed_on: "2026-10-02" }, // no entertainment
    { id: "d5", name: "Zoho", account_name: null, amount_inr: 300000, stage: "won", closed_on: "2026-10-02" }, // no entertainment
  ];
  const bookings = [
    { id: "b1", crm_deal_id: "d1", status: "COMPLETED", spend_inr: 30000 },
    { id: "b2", crm_deal_id: "d1", status: "SETTLED", spend_inr: 20000 },
    { id: "b3", crm_deal_id: "d2", status: "CONFIRMED", spend_inr: 10000 },
    { id: "b4", crm_deal_id: "d3", status: "COMPLETED", spend_inr: 40000 },
    { id: "b5", crm_deal_id: "d1", status: "PENDING_APPROVAL", spend_inr: 99999 }, // not spend yet
    { id: "b6", crm_deal_id: null, status: "CONFIRMED", spend_inr: 5000 },
    { id: "b7", crm_deal_id: "gone", status: "CONFIRMED", spend_inr: 1000 }, // deal deleted → unlinked
  ];
  const s = dealRoi(deals, bookings);
  assert.equal(s.linkedSpend, 100000);
  assert.equal(s.unlinkedSpend, 6000);
  assert.equal(s.wonRevenue, 1000000);
  assert.equal(s.wonSpend, 50000);
  assert.equal(s.influencedPipeline, 400000);
  assert.equal(s.roiMultiple, 10);
  assert.equal(s.winRate, 0.5); // d1 won, d3 lost
  assert.equal(s.baselineWinRate, 0.5); // d5 won, d4 lost
  assert.deepEqual(s.deals.map((d) => d.id), ["d1", "d3", "d2", "d5", "d4"]);
  assert.equal(s.deals[0].multiple, 20);
  assert.equal(s.deals.find((d) => d.id === "d3").multiple, null);
  assert.equal(dealRoi([], []).roiMultiple, null);
});

test("DB: a booking can only link to its own company's deal; deleting a deal unlinks", async () => {
  const { createDatabase } = await import("./support/supabase-pglite.mjs");
  const db = await createDatabase();
  const { rows: cos } = await db.query("select id from public.companies order by id limit 2");
  assert.ok(cos.length >= 2, "seed has two companies");
  const { rows: [b] } = await db.query("select id, company_id from public.bookings where company_id = $1 limit 1", [cos[0].id]);
  const other = cos.find((c) => c.id !== b.company_id).id;
  const ins = "insert into public.crm_deals (company_id, provider, external_id, name, amount_inr, stage) values ($1, 'zoho', $2, 'Deal', 1000, 'won') returning id";
  const { rows: [mine] } = await db.query(ins, [b.company_id, "z1"]);
  const { rows: [theirs] } = await db.query(ins, [other, "z1"]); // same CRM id, other company: allowed

  await db.query("update public.bookings set crm_deal_id = $1 where id = $2", [mine.id, b.id]);
  await assert.rejects(db.query("update public.bookings set crm_deal_id = $1 where id = $2", [theirs.id, b.id]), /does not belong/);
  await assert.rejects(db.query(ins, [b.company_id, "z1"]), /duplicate key/);
  await assert.rejects(db.query("insert into public.crm_deals (company_id, external_id, name, stage) values ($1, 'x', 'D', 'maybe')", [b.company_id]), /check/);

  await db.query("delete from public.crm_deals where id = $1", [mine.id]);
  const { rows: [after] } = await db.query("select crm_deal_id from public.bookings where id = $1", [b.id]);
  assert.equal(after.crm_deal_id, null);
  await db.close();
});
