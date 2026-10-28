import type { Metadata } from "next";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CATEGORY_LABEL, isCategory } from "@/lib/catalog/items";
import { getShopSession, punchoutCatalog } from "@/lib/punchout/store";
import { PunchoutShop } from "./_components/punchout-shop";

// The token in the URL is a credential: keep it out of Referer headers and search engines.
export const metadata: Metadata = { title: "Lufer.ai catalogue", referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The lower of an item's per-order limit and its stock; null when neither is set. */
const maxOf = (...limits: (number | null)[]) => {
  const set = limits.filter((n): n is number => n !== null);
  return set.length ? Math.min(...set) : null;
};

/**
 * The punchout shop: opened from a buyer's procurement system (Coupa, Ariba…)
 * with a one-time token. The employee fills a cart and sends it back to their
 * requisition; no Lufer.ai sign-in.
 */
export default async function PunchoutPage({ params }: PageProps<"/punchout/[token]">) {
  const { token } = await params;
  const session = await getShopSession(token).catch((err) => {
    console.error("punchout: could not load session", err);
    return null;
  });
  if (!session) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>This catalogue link has expired</CardTitle>
            <CardDescription>Punchout links last two hours and work once. Go back to your procurement system and open the Lufer.ai catalogue again.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }
  const items = await punchoutCatalog();

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-[calc(2rem+var(--app-safe-top))] pb-[calc(3rem+var(--app-safe-bottom))]">
      <header className="mb-6">
        <p className="text-fg-subtle text-caption font-medium">Lufer.ai · {session.companyName}</p>
        <h1 className="text-fg text-section font-semibold">{session.operation === "inspect" ? "Your cart" : "Add to your requisition"}</h1>
        <p className="text-fg-muted mt-1 text-body">
          {session.userName ? `Hi ${session.userName.split(" ")[0]}. ` : ""}Choose items and quantities, then send the cart back to your procurement system for approval. Prices are before GST; tax is invoiced at each item&apos;s rate.
        </p>
      </header>
      <PunchoutShop
        token={token}
        readOnly={session.operation === "inspect" || session.returned}
        returned={session.returned}
        initial={Object.fromEntries(session.cart.map((l) => [l.itemId, l.quantity]))}
        items={items.map((i) => ({
          id: i.id,
          name: i.name,
          supplier: i.partner_name,
          category: isCategory(i.category) ? CATEGORY_LABEL[i.category] : i.category,
          description: i.description,
          unitPrice: Number(i.unit_price_inr),
          gstRate: Number(i.gst_rate_percent),
          min: i.min_quantity,
          max: maxOf(i.max_quantity, i.stock_quantity),
        }))}
      />
    </main>
  );
}
