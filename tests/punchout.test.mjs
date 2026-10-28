// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// cXML PunchOut (lib/punchout/cxml.ts): setup and order requests as Coupa and
// Ariba send them, entity/DTD refusal, the cart message, and matching a PO to
// its cart; and migration 20261109000000's grants on PGlite.
import { test, before } from "node:test";
import assert from "node:assert/strict";

import {
  CxmlError,
  matchOrderToCart,
  orderMessage,
  parseCxml,
  parseOrderRequest,
  parseSetupRequest,
  senderOf,
  setupResponse,
  statusResponse,
  xmlEscape,
} from "../lib/punchout/cxml.ts";
import { asUser, createDatabase } from "./support/supabase-pglite.mjs";

const SESSION = "6f1e2d3c-4b5a-4968-8776-655443322110";
const ITEM = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const OTHER_ITEM = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

const setupXml = ({ secret = "s3cret", formPost = "https://acme.coupahost.com/punchout/checkout?id=42", operation = "create", doctype = true } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
${doctype ? '<!DOCTYPE cXML SYSTEM "http://xml.cxml.org/schemas/cXML/1.2.014/cXML.dtd">' : ""}
<cXML payloadID="1700000000.1@acme.coupahost.com" timestamp="2026-10-28T10:00:00+05:30" xml:lang="en-US">
  <Header>
    <From><Credential domain="DUNS"><Identity>123456789</Identity></Credential><Credential domain="NetworkID"><Identity>acme-coupa</Identity></Credential></From>
    <To><Credential domain="DUNS"><Identity>lufer.ai</Identity></Credential></To>
    <Sender><Credential domain="NetworkID"><Identity>acme-coupa</Identity><SharedSecret>${secret}</SharedSecret></Credential><UserAgent>Coupa Procurement 1.0</UserAgent></Sender>
  </Header>
  <Request deploymentMode="production">
    <PunchOutSetupRequest operation="${operation}">
      <BuyerCookie>c0ffee-42</BuyerCookie>
      <Extrinsic name="UserEmail">Asha@Acme.example</Extrinsic>
      <Extrinsic name="UserFullName">Asha Rao</Extrinsic>
      <BrowserFormPost><URL>${formPost}</URL></BrowserFormPost>
      <Contact role="endUser"><Name xml:lang="en">Asha Rao</Name><Email>asha@acme.example</Email></Contact>
      <SupplierSetup><URL>https://lufer.ai/api/punchout/setup</URL></SupplierSetup>
    </PunchOutSetupRequest>
  </Request>
</cXML>`;

const orderXml = (lines) => `<?xml version="1.0"?>
<!DOCTYPE cXML SYSTEM "http://xml.cxml.org/schemas/cXML/1.2.014/cXML.dtd">
<cXML payloadID="po-7781@acme" timestamp="2026-10-29T09:00:00+05:30">
  <Header><From><Credential domain="NetworkID"><Identity>acme-coupa</Identity></Credential></From><To><Credential domain="NetworkID"><Identity>lufer.ai</Identity></Credential></To>
    <Sender><Credential domain="NetworkID"><Identity>acme-coupa</Identity><SharedSecret>s3cret</SharedSecret></Credential></Sender></Header>
  <Request><OrderRequest>
    <OrderRequestHeader orderID="PO-7781" orderDate="2026-10-29" type="new"><Total><Money currency="INR">5000.00</Money></Total></OrderRequestHeader>
    ${lines}
  </OrderRequest></Request>
</cXML>`;
const itemOut = ({ n = 1, qty = 10, part = ITEM, aux = SESSION, price = "500.00", currency = "INR" } = {}) =>
  `<ItemOut quantity="${qty}" lineNumber="${n}"><ItemID><SupplierPartID>${part}</SupplierPartID><SupplierPartAuxiliaryID>${aux}</SupplierPartAuxiliaryID></ItemID><ItemDetail><UnitPrice><Money currency="${currency}">${price}</Money></UnitPrice><Description xml:lang="en">Welcome kit</Description><UnitOfMeasure>EA</UnitOfMeasure></ItemDetail></ItemOut>`;

test("setup request: sender credential, cookie, return URL and the user", () => {
  const root = parseCxml(setupXml());
  assert.deepEqual(senderOf(root), { domain: "NetworkID", identity: "acme-coupa", sharedSecret: "s3cret" });
  assert.deepEqual(parseSetupRequest(root), {
    payloadId: "1700000000.1@acme.coupahost.com",
    operation: "create",
    buyerCookie: "c0ffee-42",
    browserFormPost: "https://acme.coupahost.com/punchout/checkout?id=42",
    email: "asha@acme.example",
    name: "Asha Rao",
  });
});

test("setup request: refuses http return URLs, unknown operations and missing secrets", () => {
  assert.throws(() => parseSetupRequest(parseCxml(setupXml({ formPost: "http://acme.example/x" }))), /https/);
  assert.throws(() => parseSetupRequest(parseCxml(setupXml({ operation: "delete" }))), (e) => e instanceof CxmlError && e.code === 406);
  assert.throws(() => senderOf(parseCxml(setupXml({ secret: "" }))), (e) => e instanceof CxmlError && e.code === 401);
});

test("parser: no DTD internals, entities or junk", () => {
  const xxe = `<?xml version="1.0"?><!DOCTYPE cXML [<!ENTITY x SYSTEM "file:///etc/passwd">]><cXML><Header/></cXML>`;
  assert.throws(() => parseCxml(xxe), /DTD/);
  assert.throws(() => parseCxml(`<!ENTITY a "b"><cXML/>`), /DTD/);
  assert.throws(() => parseCxml("<html><body>hi</body></html>"), /Not a cXML/);
  assert.throws(() => parseCxml("<cXML><unclosed>"), CxmlError);
  assert.throws(() => parseCxml("x".repeat(600 * 1024)), (e) => e.code === 413);
  // Without the DOCTYPE line is fine too.
  assert.equal(parseSetupRequest(parseCxml(setupXml({ doctype: false }))).buyerCookie, "c0ffee-42");
});

test("order request: header and lines", () => {
  const order = parseOrderRequest(parseCxml(orderXml(itemOut() + itemOut({ n: 2, part: OTHER_ITEM, qty: 1, price: "1200" }))));
  assert.equal(order.payloadId, "po-7781@acme");
  assert.equal(order.orderId, "PO-7781");
  assert.equal(order.total, 5000);
  assert.deepEqual(order.lines[0], { lineNumber: 1, quantity: 10, supplierPartId: ITEM, auxiliaryId: SESSION, unitPrice: 500, currency: "INR", description: "Welcome kit" });
  assert.throws(() => parseOrderRequest(parseCxml(orderXml(itemOut({ qty: 0 })))), /quantity/);
  assert.throws(() => parseOrderRequest(parseCxml(orderXml(""))), /no lines/);
});

test("matching a PO to its cart: item, session, INR, price to the paisa, no more than carted", () => {
  const carts = new Map([[SESSION, [{ itemId: ITEM, name: "Welcome kit", quantity: 10, unitPrice: 500, taxCode: "4202" }]]]);
  const check = (xml) => matchOrderToCart(parseOrderRequest(parseCxml(orderXml(xml))), carts);
  assert.deepEqual(check(itemOut()), [{ lineNumber: 1, itemId: ITEM, quantity: 10, ok: true }]);
  assert.equal(check(itemOut({ qty: 6 }))[0].ok, true, "buyers may order fewer");
  assert.match(check(itemOut({ qty: 11 }))[0].issue, /more than the 10/);
  assert.match(check(itemOut({ price: "499.99" }))[0].issue, /differs/);
  assert.match(check(itemOut({ currency: "USD" }))[0].issue, /USD/);
  assert.match(check(itemOut({ part: OTHER_ITEM }))[0].issue, /Not in the cart/);
  assert.match(check(itemOut({ aux: "11111111-2222-4333-8444-555555555555" }))[0].issue, /punchout session/);
});

test("the cart goes back as a PunchOutOrderMessage the buyer's system can read", () => {
  const xml = orderMessage({
    payloadId: "p1@lufer.ai",
    timestamp: "2026-10-28T10:05:00Z",
    buyerCookie: "c0ffee-42",
    sessionId: SESSION,
    fromIdentity: "lufer.ai",
    toIdentity: "acme-coupa",
    lines: [{ itemId: ITEM, name: 'Kit <"deluxe"> & co', quantity: 3, unitPrice: 499.5, taxCode: "4202" }],
  });
  const root = parseCxml(xml);
  const msg = root.Message.PunchOutOrderMessage;
  assert.equal(msg.BuyerCookie, "c0ffee-42");
  assert.equal(msg.PunchOutOrderMessageHeader.Total.Money["#text"], "1498.50");
  const item = msg.ItemIn[0];
  assert.equal(item["@_quantity"], "3");
  assert.equal(item.ItemID.SupplierPartAuxiliaryID, SESSION);
  assert.match(xml, /Kit &lt;&quot;deluxe&quot;&gt; &amp; co/);
});

test("responses carry a cXML status", () => {
  assert.match(setupResponse("p", "t", "https://lufer.ai/punchout/abc&x"), /<StartPage><URL>https:\/\/lufer.ai\/punchout\/abc&amp;x<\/URL><\/StartPage>/);
  assert.match(statusResponse("p", "t", 401, "Unknown sender"), /<Status code="401" text="Error">Unknown sender<\/Status>/);
  assert.equal(xmlEscape(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;");
});

// ----------------------------------------------------------------------------
// Database
// ----------------------------------------------------------------------------

const NIMBUS = "11111111-1111-4111-8111-111111111111";
const VERTEX = "22222222-2222-4222-8222-222222222222";
const ALICE = "c0000000-0000-4000-8000-000000000001"; // Nimbus
const VICTOR = "c0000000-0000-4000-8000-000000000002"; // Vertex
let db;

before(async () => {
  db = await createDatabase();
  await db.query(`insert into auth.users (id, email) values ($1, 'alice@example.test'), ($2, 'victor@example.test')`, [ALICE, VICTOR]);
  await db.query(`insert into platform_users (user_id, role, company_id, corporate_role) values ($1, 'CLIENT', $3, 'FINANCE_VIEWER'), ($2, 'CLIENT', $4, 'APPROVER')`, [ALICE, VICTOR, NIMBUS, VERTEX]);
  const { rows } = await db.query(`insert into punchout_connections (company_id, label, sender_identity, shared_secret_sha256) values ($1, 'Coupa', 'acme-coupa', $2) returning id`, [NIMBUS, "a".repeat(64)]);
  await db.query(`insert into punchout_sessions (connection_id, company_id, token_sha256, buyer_cookie, browser_form_post, expires_at) values ($1, $2, $3, 'c', 'https://x.example', now() + interval '2 hours')`, [rows[0].id, NIMBUS, "b".repeat(64)]);
  await db.query(`insert into punchout_orders (connection_id, company_id, payload_id, order_id, lines, status) values ($1, $2, 'p1', 'PO-1', '[]', 'received')`, [rows[0].id, NIMBUS]);
});

const as = (user, fn) => asUser(db, { claims: { sub: user } }, fn);

test("migration: sessions need https return URLs; one payloadID per connection", async () => {
  const { rows } = await db.query(`select id from punchout_connections`);
  await assert.rejects(db.query(`insert into punchout_sessions (connection_id, company_id, token_sha256, buyer_cookie, browser_form_post, expires_at) values ($1, $2, $3, 'c', 'http://x.example', now())`, [rows[0].id, NIMBUS, "c".repeat(64)]), /check constraint/);
  await assert.rejects(db.query(`insert into punchout_orders (connection_id, company_id, payload_id, order_id, lines, status) values ($1, $2, 'p1', 'PO-1', '[]', 'received')`, [rows[0].id, NIMBUS]), /duplicate key/);
});

test("RLS: the company sees its connection (not the secret's hash) and orders; sessions are service-only", async () => {
  assert.equal(await as(ALICE, (tx) => tx.query(`select sender_identity from punchout_connections`).then((r) => r.rows.length)), 1);
  assert.equal(await as(VICTOR, (tx) => tx.query(`select id from punchout_connections`).then((r) => r.rows.length)), 0);
  await assert.rejects(as(ALICE, (tx) => tx.query(`select shared_secret_sha256 from punchout_connections`)), /permission denied/);
  assert.equal(await as(ALICE, (tx) => tx.query(`select id from punchout_orders`).then((r) => r.rows.length)), 1);
  assert.equal(await as(VICTOR, (tx) => tx.query(`select id from punchout_orders`).then((r) => r.rows.length)), 0);
  await assert.rejects(as(ALICE, (tx) => tx.query(`select id from punchout_sessions`)), /permission denied/);
});
