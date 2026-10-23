// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// Self-service signup with admin approval:
//   1. the rules: form validation (lib/auth/signup-input.ts) and where people
//      land (lib/auth/onboarding.ts)
//   2. the middleware (lib/supabase/middleware.ts) against a local stand-in for
//      Supabase Auth and PostgREST: applicants go to /signup/pending, approved
//      users to their portal
//   3. the admin's approveUser / rejectUser actions on the in-memory store, and
//      routing afterwards
//   4. migration 20261103000000 in Postgres (PGlite): RLS on applications and
//      decide_signup_application
import { signIn } from "../support/server-actions.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { computeGstinChecksum } from "../../lib/gst-engine.ts";
import { ACCOUNT_HOME, landingFor, NO_ACCESS_PATH, PENDING_PATH } from "../../lib/auth/onboarding.ts";
import { normalizeWebsite, parseSignupInput } from "../../lib/auth/signup-input.ts";
import { asUser, createDatabase } from "../support/supabase-pglite.mjs";

const { NextRequest } = await import("next/server");
const { updateSession } = await import("../../lib/supabase/middleware.ts");
const { approveUser, rejectUser } = await import("../../app/(dashboard)/admin/approvals/actions.ts");
const { createSignupApplication, getSignupApplication, listSignupApplications } = await import("../../lib/data/index.ts");
const { mutateDb, readDb } = await import("../../lib/data/local-store.ts");
const { spendLimitFor } = await import("../../lib/policies/checkBookingPolicy.ts");
const { evaluateBookingPolicy } = await import("../../lib/policies/evaluate-booking-policy.ts");

const gstin = (first14) => first14 + computeGstinChecksum(first14);
const NEW_CO_GSTIN = gstin("29AAACZ1234Q1Z");
const NIMBUS_GSTIN = "29AABCN4821K1ZA"; // a seeded customer

const enterprise = (over = {}) => ({ account_type: "enterprise", email: "Asha@Zenith.example", full_name: "  Asha   Rao ", company_name: "Zenith Robotics Pvt Ltd", gstin: NEW_CO_GSTIN, phone: "98450 12345", ...over });
const partner = (over = {}) => ({ account_type: "partner", email: "bookings@beatbox.example", full_name: "Kabir Sen", company_name: "Beatbox Collective", partner_role: "entertainment", venue_website: "beatbox.example/showreel", ...over });

// ---------------------------------------------------------------------------
// 1. Rules
// ---------------------------------------------------------------------------

describe("signup form", () => {
  test("an enterprise application is normalised: email lower-cased, names tidied, phone in E.164", () => {
    const r = parseSignupInput(enterprise());
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, {
      account_type: "enterprise",
      email: "asha@zenith.example",
      full_name: "Asha Rao",
      company_name: "Zenith Robotics Pvt Ltd",
      phone: "+919845012345",
      job_title: null,
      city: null,
      message: null,
      gstin: NEW_CO_GSTIN,
      venue_website: null,
      partner_role: null,
    });
  });

  test("an enterprise needs a valid GSTIN", () => {
    assert.deepEqual(parseSignupInput(enterprise({ gstin: "" })).errors, { gstin: "Enter your company's GSTIN: invoices are raised on it." });
    assert.match(parseSignupInput(enterprise({ gstin: "29AAACZ1234Q1Z9" })).errors.gstin, /isn't valid/);
  });

  test("a partner needs what they offer and a website; the website gets https://", () => {
    const r = parseSignupInput(partner());
    assert.equal(r.ok, true);
    assert.equal(r.value.venue_website, "https://beatbox.example/showreel");
    assert.equal(r.value.partner_role, "entertainment");
    assert.equal(r.value.gstin, null, "GSTIN is optional for partners");
    const bad = parseSignupInput(partner({ partner_role: "astronaut", venue_website: "not a site" }));
    assert.deepEqual(Object.keys(bad.errors).sort(), ["partner_role", "venue_website"]);
  });

  test("missing basics and an unknown account type are field errors", () => {
    const r = parseSignupInput({ account_type: "vendor", email: "nope", full_name: "A", company_name: "" });
    assert.deepEqual(Object.keys(r.errors).sort(), ["account_type", "company_name", "email", "full_name"]);
    assert.match(parseSignupInput(enterprise({ phone: "12345" })).errors.phone, /mobile number/);
  });

  test("websites: http(s) only, with a real host", () => {
    assert.equal(normalizeWebsite("http://studio.in"), "http://studio.in/");
    assert.equal(normalizeWebsite("instagram.com/beatbox"), "https://instagram.com/beatbox");
    for (const bad of ["", "javascript:alert(1)", "ftp://x.in", "localhost", "https://"]) assert.equal(normalizeWebsite(bad), null, bad);
  });
});

describe("landing", () => {
  test("members go to their role's portal, whatever their application says", () => {
    assert.equal(landingFor("CLIENT", "active"), "/client");
    assert.equal(landingFor("PARTNER", null), "/partner");
    assert.equal(landingFor("ADMIN", "pending_approval"), "/admin");
  });

  test("applicants wait at /signup/pending, pending or rejected; everyone else has no access", () => {
    assert.equal(landingFor(null, "pending_approval"), PENDING_PATH);
    assert.equal(landingFor(null, "rejected"), PENDING_PATH);
    assert.equal(landingFor(null, null), NO_ACCESS_PATH);
    // Approved but no role: access was removed since. Not the waiting room (it would loop).
    assert.equal(landingFor(null, "active"), NO_ACCESS_PATH);
  });

  test("approved enterprises land on /client, partners on /partner", () => {
    assert.deepEqual(ACCOUNT_HOME, { enterprise: "/client", partner: "/partner" });
    assert.equal(landingFor("CLIENT", "active"), ACCOUNT_HOME.enterprise);
    assert.equal(landingFor("PARTNER", "active"), ACCOUNT_HOME.partner);
  });
});

// ---------------------------------------------------------------------------
// 2. The middleware, against a stand-in Supabase
// ---------------------------------------------------------------------------

describe("middleware", () => {
  /** Who exists: user id → their platform_users row and application, as PostgREST would return them. */
  let world = new Map();
  let server;
  before(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      const json = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const userId = token ? JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub : null;
      if (url.pathname === "/auth/v1/user") return userId ? json(200, { id: userId, aud: "authenticated", role: "authenticated", email: `${userId}@x.example` }) : json(401, { message: "no token" });
      const who = world.get(String(url.searchParams.get("user_id") ?? "").replace(/^eq\./, ""));
      const one = (row) => (req.headers.accept?.includes("vnd.pgrst.object") ? (row ? json(200, row) : json(406, { code: "PGRST116" })) : json(200, row ? [row] : []));
      if (url.pathname === "/rest/v1/platform_users") return one(who?.member ?? null);
      if (url.pathname === "/rest/v1/signup_applications") return one(who?.application ?? null);
      json(404, {});
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  });
  after(() => {
    server.close();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  /** A request carrying a signed-in session for `userId` (or none), as @supabase/ssr stores it. */
  function request(path, userId) {
    const headers = new Headers();
    if (userId) {
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const access_token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: userId, exp, aud: "authenticated", role: "authenticated" })}.sig`;
      const session = { access_token, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: exp, user: { id: userId, aud: "authenticated" } };
      headers.set("cookie", `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`);
    }
    return new NextRequest(`https://lufer.test${path}`, { headers });
  }
  const destination = async (path, userId) => {
    const res = await updateSession(request(path, userId));
    const loc = res.headers.get("location");
    return loc ? new URL(loc).pathname + new URL(loc).search : null;
  };

  test("a pending applicant opening a portal is sent to /signup/pending", async () => {
    world = new Map([["u-pending", { application: { status: "pending_approval" } }]]);
    assert.equal(await destination("/client", "u-pending"), PENDING_PATH);
    assert.equal(await destination("/partner", "u-pending"), PENDING_PATH);
    assert.equal(await destination("/governance", "u-pending"), PENDING_PATH);
  });

  test("a rejected applicant is sent to /signup/pending too (it explains why)", async () => {
    world = new Map([["u-rejected", { application: { status: "rejected" } }]]);
    assert.equal(await destination("/client", "u-rejected"), PENDING_PATH);
  });

  test("someone signed in who never applied has no access; signed out goes to sign in", async () => {
    world = new Map();
    assert.equal(await destination("/client", "u-nobody"), NO_ACCESS_PATH);
    assert.equal(await destination("/client", null), "/login?next=%2Fclient");
  });

  test("once approved, an enterprise opens /client and a partner /partner; the wrong portal sends them home", async () => {
    world = new Map([
      ["u-co", { member: { role: "CLIENT", corporate_role: "APPROVER" }, application: { status: "active" } }],
      ["u-partner", { member: { role: "PARTNER", corporate_role: null }, application: { status: "active" } }],
    ]);
    assert.equal(await destination("/client", "u-co"), null, "allowed through");
    assert.equal(await destination("/partner", "u-partner"), null, "allowed through");
    assert.equal(await destination("/partner", "u-co"), "/client");
    assert.equal(await destination("/client", "u-partner"), "/partner");
  });

  test("public pages, the signup flow included, aren't gated", async () => {
    world = new Map([["u-pending", { application: { status: "pending_approval" } }]]);
    for (const path of ["/signup", PENDING_PATH, "/login", "/"]) assert.equal(await destination(path, "u-pending"), null, path);
  });
});

// ---------------------------------------------------------------------------
// 3. Admin actions on the in-memory store
// ---------------------------------------------------------------------------

describe("admin approval actions", () => {
  const ADMIN = "00000000-0000-4000-8000-0000000000ad";
  const ASHA = "aaaaaaaa-1111-4000-8000-000000000001";
  const KABIR = "aaaaaaaa-1111-4000-8000-000000000002";
  const NEHA = "aaaaaaaa-1111-4000-8000-000000000003";
  const asAdmin = () => signIn({ role: "ADMIN", userId: ADMIN, companyId: null });
  const roleOf = async (userId) => (await readDb()).users.find((u) => u.user_id === userId);

  beforeEach(async () => {
    await mutateDb((db) => {
      const ids = new Set([ASHA, KABIR, NEHA]);
      db.signupApplications = [];
      db.users = db.users.filter((u) => !ids.has(u.user_id));
      db.companies = db.companies.filter((c) => c.gstin !== NEW_CO_GSTIN);
      db.partners = db.partners.filter((p) => !p.slug.startsWith("beatbox-collective"));
    });
    const apply = (id, input) => createSignupApplication(id, parseSignupInput(input).value);
    await apply(ASHA, enterprise());
    await apply(KABIR, partner());
    await apply(NEHA, enterprise({ email: "neha@nimbus.example", full_name: "Neha Iyer", company_name: "Nimbus", gstin: NIMBUS_GSTIN }));
  });
  after(() => signIn(null));

  test("applications start pending and are recorded once per person", async () => {
    const first = await getSignupApplication(ASHA);
    assert.equal(first.status, "pending_approval");
    const again = await createSignupApplication(ASHA, parseSignupInput(enterprise({ company_name: "Something Else" })).value);
    assert.equal(again.id, first.id);
    assert.equal(again.company_name, "Zenith Robotics Pvt Ltd");
    assert.equal((await listSignupApplications({ status: "pending_approval" })).length, 3);
    // Pending: no portal access, so the waiting room.
    assert.equal(await roleOf(ASHA), undefined);
    assert.equal(landingFor(null, first.status), PENDING_PATH);
  });

  test("approving an enterprise creates its company and makes them its Approver; they then land on /client", async () => {
    asAdmin();
    const r = await approveUser(ASHA);
    assert.equal(r.ok, true, JSON.stringify(r));
    const app = await getSignupApplication(ASHA);
    assert.equal(app.status, "active");
    assert.equal(app.reviewed_by, ADMIN);
    const db = await readDb();
    const company = db.companies.find((c) => c.id === app.company_id);
    assert.deepEqual([company.legal_name, company.gstin, company.state_code], ["Zenith Robotics Pvt Ltd", NEW_CO_GSTIN, "29"]);
    const user = await roleOf(ASHA);
    assert.deepEqual([user.role, user.company_id, user.corporate_role], ["CLIENT", company.id, "APPROVER"]);
    assert.equal(landingFor(user.role, app.status), "/client");
  });

  test("a newly approved company has no monthly spend limit (0 = unlimited): its first booking isn't held up", async () => {
    asAdmin();
    await approveUser(ASHA);
    const { company_id } = await getSignupApplication(ASHA);
    const company = (await readDb()).companies.find((c) => c.id === company_id);
    assert.equal(company.monthly_spend_limit_inr, 0);
    // No limit to check against: the monthly-limit rule is skipped, however large the booking.
    const booking = { total_amount: 5_000_000, per_head_amount: 2500, event_date: "2026-12-05" };
    assert.equal(await spendLimitFor(company.id, booking.event_date), null);
    assert.deepEqual(evaluateBookingPolicy(null, booking, await spendLimitFor(company.id, booking.event_date)), { requiresApproval: false });

    // Whereas once a limit is set, the same booking breaches it (so the check above is meaningful).
    await mutateDb((db) => {
      db.companies.find((c) => c.id === company.id).monthly_spend_limit_inr = 100_000;
    });
    const limited = evaluateBookingPolicy(null, booking, await spendLimitFor(company.id, booking.event_date));
    assert.deepEqual(limited.codes, ["OVER_MONTHLY_LIMIT"]);
  });

  test("approving a partner creates their partner organisation, with them as Owner; they then land on /partner", async () => {
    asAdmin();
    assert.equal((await approveUser(KABIR)).ok, true);
    const app = await getSignupApplication(KABIR);
    const p = (await readDb()).partners.find((x) => x.id === app.partner_id);
    assert.deepEqual([p.name, p.slug, p.contact_email, p.status], ["Beatbox Collective", "beatbox-collective", "bookings@beatbox.example", "active"]);
    const user = await roleOf(KABIR);
    assert.deepEqual([user.role, user.partner_id, user.partner_role], ["PARTNER", p.id, "OWNER"]);
    assert.equal(landingFor(user.role, app.status), "/partner");
  });

  test("an enterprise applicant with an existing customer's GSTIN joins it as an Organizer", async () => {
    asAdmin();
    const before = (await readDb()).companies.length;
    assert.equal((await approveUser(NEHA)).ok, true);
    const db = await readDb();
    assert.equal(db.companies.length, before, "no new company");
    const nimbus = db.companies.find((c) => c.gstin === NIMBUS_GSTIN);
    const user = await roleOf(NEHA);
    assert.deepEqual([user.company_id, user.corporate_role], [nimbus.id, "ORGANIZER"]);
  });

  test("rejecting records the reason and gives no access; they keep seeing the waiting room", async () => {
    asAdmin();
    const r = await rejectUser(KABIR, "  We can't verify the showreel link. ");
    assert.deepEqual(r, { ok: true, message: "Kabir Sen's application was rejected." });
    const app = await getSignupApplication(KABIR);
    assert.equal(app.status, "rejected");
    assert.equal(app.rejection_reason, "We can't verify the showreel link.");
    assert.equal(await roleOf(KABIR), undefined);
    assert.equal(landingFor(null, app.status), PENDING_PATH);
  });

  test("a decided application can't be decided again", async () => {
    asAdmin();
    await rejectUser(ASHA);
    assert.deepEqual(await approveUser(ASHA), { ok: false, error: "This application has already been decided." });
    assert.equal(await roleOf(ASHA), undefined);
  });

  test("someone who already has portal access isn't given a second membership", async () => {
    await mutateDb((db) => {
      db.users.push({ user_id: ASHA, role: "CLIENT", company_id: db.companies[0].id, venue_id: null, partner_id: null, partner_role: null, corporate_role: "ORGANIZER", created_at: new Date().toISOString(), name: "Asha Rao" });
    });
    asAdmin();
    assert.deepEqual(await approveUser(ASHA), { ok: false, error: "This person already has portal access." });
    assert.equal((await getSignupApplication(ASHA)).status, "pending_approval");
  });

  test("only platform admins can decide; unknown applicants are refused", async () => {
    signIn({ role: "CLIENT", userId: "dddddddd-0002-4000-8000-000000000002", companyId: "11111111-1111-4111-8111-111111111111", corporateRole: "APPROVER" });
    assert.deepEqual(await approveUser(ASHA), { ok: false, error: "Only platform admins can approve accounts." });
    signIn({ role: "PARTNER", userId: "dddddddd-0009-4000-8000-000000000009", companyId: null, partnerId: "p", partnerRole: "OWNER" });
    assert.equal((await rejectUser(ASHA)).ok, false);
    assert.equal((await getSignupApplication(ASHA)).status, "pending_approval");

    asAdmin();
    assert.deepEqual(await approveUser("not-a-uuid"), { ok: false, error: "Unknown applicant." });
    assert.deepEqual(await approveUser("aaaaaaaa-1111-4000-8000-0000000000ff"), { ok: false, error: "This application was not found." });
  });

  test("signed out, the actions don't run", async () => {
    signIn(null);
    await assert.rejects(approveUser(ASHA), /NEXT_REDIRECT/);
    assert.equal((await getSignupApplication(ASHA)).status, "pending_approval");
  });
});

// ---------------------------------------------------------------------------
// 4. The migration in Postgres
// ---------------------------------------------------------------------------

describe("migration: signup_applications and decide_signup_application", () => {
  const ADMIN = "00000000-0000-4000-8000-0000000000ad";
  const APPLICANT = "aaaaaaaa-2222-4000-8000-000000000001";
  const PARTNER_APPLICANT = "aaaaaaaa-2222-4000-8000-000000000002";
  const JOINER = "aaaaaaaa-2222-4000-8000-000000000003";
  const STRANGER = "aaaaaaaa-2222-4000-8000-000000000004";
  let db;
  const ids = {};

  before(async () => {
    db = await createDatabase();
    for (const id of [ADMIN, APPLICANT, PARTNER_APPLICANT, JOINER, STRANGER]) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@x.example`]);
    await db.query("insert into public.platform_users (user_id, role) values ($1, 'ADMIN')", [ADMIN]);
    const insert = async (userId, cols) => {
      const keys = ["user_id", ...Object.keys(cols)];
      const { rows } = await db.query(`insert into public.signup_applications (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, [userId, ...Object.values(cols)]);
      return rows[0].id;
    };
    ids.enterprise = await insert(APPLICANT, { email: "asha@zenith.example", full_name: "Asha Rao", account_type: "enterprise", company_name: "Zenith Robotics", gstin: NEW_CO_GSTIN });
    ids.partner = await insert(PARTNER_APPLICANT, { email: "kabir@beatbox.example", full_name: "Kabir Sen", account_type: "partner", company_name: "Beatbox Collective", partner_role: "entertainment", venue_website: "https://beatbox.example" });
    ids.joiner = await insert(JOINER, { email: "neha@nimbus.example", full_name: "Neha Iyer", account_type: "enterprise", company_name: "Nimbus", gstin: NIMBUS_GSTIN });
  });

  const as = (sub, fn) => asUser(db, { claims: { sub } }, fn);
  const service = (fn) => asUser(db, { role: "service_role" }, fn);
  const decide = (tx, id, decision, reason = null) => tx.query("select * from public.decide_signup_application($1, $2, $3, $4)", [id, decision, ADMIN, reason]);

  test("applications start pending_approval", async () => {
    const { rows } = await db.query("select status, reviewed_at from public.signup_applications where id = $1", [ids.enterprise]);
    assert.deepEqual(rows[0], { status: "pending_approval", reviewed_at: null });
  });

  test("an applicant reads only their own application; a stranger reads none; an admin reads all", async () => {
    assert.deepEqual(await as(APPLICANT, async (tx) => (await tx.query("select user_id from public.signup_applications")).rows), [{ user_id: APPLICANT }]);
    assert.deepEqual(await as(STRANGER, async (tx) => (await tx.query("select user_id from public.signup_applications")).rows), []);
    assert.equal(await as(ADMIN, async (tx) => (await tx.query("select count(*)::int as n from public.signup_applications")).rows[0].n), 3);
  });

  test("signed-in users can't write applications or call the approval function", async () => {
    await assert.rejects(as(STRANGER, (tx) => tx.query("insert into public.signup_applications (user_id, email, full_name, account_type, company_name, gstin) values ($1, 'a@b.co', 'Me Me', 'enterprise', 'Me Co', $2)", [STRANGER, NEW_CO_GSTIN])), /permission denied/);
    await assert.rejects(as(APPLICANT, (tx) => tx.query("update public.signup_applications set status = 'active' where user_id = $1", [APPLICANT])), /permission denied/);
    // Not even an admin's own session: decisions go through the service role, after the app's checks.
    await assert.rejects(as(ADMIN, (tx) => decide(tx, ids.enterprise, "active")), /permission denied/);
  });

  test("the table's checks: an enterprise needs a GSTIN, a partner its kind, status is one of three", async () => {
    await assert.rejects(db.query("insert into public.signup_applications (user_id, email, full_name, account_type, company_name) values ($1, 'a@b.co', 'Me Me', 'enterprise', 'Me Co')", [STRANGER]), /signup_applications_enterprise_gstin/);
    await assert.rejects(db.query("insert into public.signup_applications (user_id, email, full_name, account_type, company_name) values ($1, 'a@b.co', 'Me Me', 'partner', 'Me Co')", [STRANGER]), /signup_applications_partner_role/);
    await assert.rejects(db.query("update public.signup_applications set status = 'approved' where id = $1", [ids.enterprise]), /check constraint/);
  });

  test("approving an enterprise creates the company and a CLIENT Approver, in one go", async () => {
    const out = await service(async (tx) => {
      const app = (await decide(tx, ids.enterprise, "active")).rows[0];
      const company = (await tx.query("select legal_name, gstin, state_code from public.companies where id = $1", [app.company_id])).rows[0];
      const member = (await tx.query("select role, company_id, corporate_role from public.platform_users where user_id = $1", [APPLICANT])).rows[0];
      return { app, company, member };
    });
    assert.equal(out.app.status, "active");
    assert.equal(out.app.reviewed_by, ADMIN);
    assert.ok(out.app.reviewed_at);
    assert.deepEqual(out.company, { legal_name: "Zenith Robotics", gstin: NEW_CO_GSTIN, state_code: "29" });
    assert.deepEqual(out.member, { role: "CLIENT", company_id: out.app.company_id, corporate_role: "APPROVER" });
  });

  test("an existing customer's GSTIN: the applicant joins it as an Organizer", async () => {
    const out = await service(async (tx) => {
      const app = (await decide(tx, ids.joiner, "active")).rows[0];
      const nimbus = (await tx.query("select id from public.companies where gstin = $1", [NIMBUS_GSTIN])).rows[0];
      const member = (await tx.query("select company_id, corporate_role from public.platform_users where user_id = $1", [JOINER])).rows[0];
      return { app, nimbus, member };
    });
    assert.equal(out.app.company_id, out.nimbus.id);
    assert.deepEqual(out.member, { company_id: out.nimbus.id, corporate_role: "ORGANIZER" });
  });

  test("approving a partner creates the organisation with a unique slug and an OWNER membership", async () => {
    const out = await service(async (tx) => {
      // Someone already has the obvious slug.
      await tx.query("insert into public.partners (name, slug) values ('Beatbox Collective (Pune)', 'beatbox-collective')");
      const app = (await decide(tx, ids.partner, "active")).rows[0];
      const p = (await tx.query("select name, slug, contact_email, status from public.partners where id = $1", [app.partner_id])).rows[0];
      const member = (await tx.query("select role, partner_id, partner_role from public.platform_users where user_id = $1", [PARTNER_APPLICANT])).rows[0];
      return { app, p, member };
    });
    assert.deepEqual(out.p, { name: "Beatbox Collective", slug: "beatbox-collective-2", contact_email: "kabir@beatbox.example", status: "active" });
    assert.deepEqual(out.member, { role: "PARTNER", partner_id: out.app.partner_id, partner_role: "OWNER" });
  });

  test("rejecting records the reason and creates nothing", async () => {
    const out = await service(async (tx) => {
      const app = (await decide(tx, ids.partner, "rejected", "  Couldn't verify  ")).rows[0];
      const members = (await tx.query("select count(*)::int as n from public.platform_users where user_id = $1", [PARTNER_APPLICANT])).rows[0].n;
      return { app, members };
    });
    assert.deepEqual([out.app.status, out.app.rejection_reason, out.app.partner_id, out.members], ["rejected", "Couldn't verify", null, 0]);
  });

  test("a decided application can't be decided again; an existing member can't be approved", async () => {
    await assert.rejects(
      service(async (tx) => {
        await decide(tx, ids.enterprise, "rejected");
        await decide(tx, ids.enterprise, "active");
      }),
      /already been decided/
    );
    await assert.rejects(
      service(async (tx) => {
        await tx.query("insert into public.platform_users (user_id, role) values ($1, 'ADMIN')", [APPLICANT]);
        await decide(tx, ids.enterprise, "active");
      }),
      /already has portal access/
    );
    await assert.rejects(service((tx) => decide(tx, ids.enterprise, "approved")), /decision must be active or rejected/);
  });
});
