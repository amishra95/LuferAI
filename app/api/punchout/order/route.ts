import { parseOrderRequest, senderOf, statusResponse } from "@/lib/punchout/cxml";
import { cxmlFailure, payloadId, readCxml, timestamp, xmlResponse } from "@/lib/punchout/http";
import { authenticate, receiveOrder } from "@/lib/punchout/store";

/**
 * POST /api/punchout/order — cXML OrderRequest: the buyer's approved purchase
 * order for a punchout cart. Recorded once per payloadID (retries get the same
 * answer) with every line matched to its cart; lines that don't match are
 * held for review rather than refused, so the PO is never lost.
 */
export async function POST(request: Request) {
  try {
    const root = await readCxml(request);
    const connection = await authenticate(senderOf(root));
    const order = await receiveOrder(connection, parseOrderRequest(root));
    const note = order.status === "received" ? `Order ${order.order_id} received.` : `Order ${order.order_id} received; some lines need review by Lufer.ai.`;
    return xmlResponse(statusResponse(payloadId(), timestamp(), 200, note));
  } catch (err) {
    return cxmlFailure("api/punchout/order", err);
  }
}
