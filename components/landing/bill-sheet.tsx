/*
 * Hero: one page of a GST bill book, with its pink duplicate showing beneath and
 * two rubber stamps landing on it (IN POLICY, then APPROVED; CSS only, settled at
 * once under reduced motion).
 * Illustrative: the same booking as the "How it works" preview, and the arithmetic
 * is real: 40 × ₹2,450 = ₹98,000, CGST + SGST at 9% each.
 */

const LINES = [
  { item: "Team dinner, private room", qty: "40", rate: "2,450", amount: "98,000" },
  { item: "CGST @ 9%", qty: "", rate: "", amount: "8,820" },
  { item: "SGST @ 9%", qty: "", rate: "", amount: "8,820" },
];

export function BillSheet() {
  return (
    <figure aria-hidden className="@container relative mx-auto w-full max-w-[34rem] select-none lg:mr-0">
      {/* The duplicate copy, pink, offset beneath the original. */}
      <div className="bg-duplicate absolute inset-0 translate-x-3 translate-y-4 rotate-[2.2deg] rounded-[6px] shadow-[0_18px_40px_-20px_rgb(0_0_0/0.45)]">
        <span className="font-ledger text-carbon/60 absolute bottom-2 left-5 text-[11px] tracking-[0.2em] uppercase">Duplicate</span>
      </div>

      <div className="text-carbon relative rounded-[6px] bg-white px-5 pt-5 pb-6 shadow-[0_24px_50px_-24px_rgb(0_0_0/0.55)] sm:px-7 sm:pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-display font-wide text-lg font-bold tracking-wide uppercase sm:text-xl">Tax invoice</p>
            <p className="text-carbon/70 mt-0.5 text-caption">SAC 998596 · Lufer, Bengaluru</p>
          </div>
          <div className="text-right">
            <p className="font-ledger text-meta">
              No. <span className="text-base font-bold">0419</span>
            </p>
            <p className="text-carbon/60 mt-1 text-[10px] font-semibold tracking-[0.2em] uppercase">Specimen</p>
          </div>
        </div>

        <p className="border-ruling text-carbon/80 mt-4 border-y-[3px] border-double py-2 text-caption">
          The Copper Courtyard, Indiranagar · Fri, 8 pm · quoted direct, checked against Engineering policy
        </p>

        <table className="mt-1 w-full text-left">
          <thead>
            <tr className="text-carbon/60 border-ruling border-b text-[11px] tracking-[0.08em] uppercase">
              <th className="py-2 font-semibold">Particulars</th>
              <th className="py-2 pl-4 text-right font-semibold">Qty</th>
              <th className="hidden py-2 pl-4 text-right font-semibold @[30rem]:table-cell">Rate ₹</th>
              <th className="py-2 pl-4 text-right font-semibold">Amount ₹</th>
            </tr>
          </thead>
          <tbody className="font-ledger text-meta @[30rem]:text-[15px]">
            {LINES.map((l) => (
              <tr key={l.item} className="border-ruling border-b">
                <td className="py-2.5 pr-2">{l.item}</td>
                <td className="py-2.5 pl-4 text-right tabular-nums">{l.qty}</td>
                <td className="hidden py-2.5 pl-4 text-right tabular-nums @[30rem]:table-cell">{l.rate}</td>
                <td className="py-2.5 pl-4 text-right tabular-nums">{l.amount}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-ledger border-carbon border-t-[3px] border-double text-[15px] font-bold sm:text-base">
              <td className="pt-3">Total</td>
              <td />
              <td className="hidden @[30rem]:table-cell" />
              <td className="pt-3 text-right tabular-nums">1,15,640</td>
            </tr>
          </tfoot>
        </table>

        {/* Stamped over the line items, ink multiplied into the print beneath. */}
        {/* Positions keep clear of the figures at every sheet width: over the blank middle of the tax rows and of the Total row. */}
        <span className="bill-stamp bill-stamp-1 absolute top-[57%] left-[30%]">In policy</span>
        <span className="bill-stamp bill-stamp-2 absolute bottom-[5%] left-[22%] @[30rem]:left-[30%]">Approved</span>
      </div>
    </figure>
  );
}
