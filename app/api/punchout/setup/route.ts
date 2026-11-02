import { parseSetupRequest, senderOf, setupResponse } from "@/lib/punchout/cxml";
import { cxmlFailure, payloadId, readCxml, timestamp, xmlResponse } from "@/lib/punchout/http";
import { authenticate, startSession } from "@/lib/punchout/store";
import { siteUrl } from "@/lib/site-url";

/**
 * POST /api/punchout/setup — cXML PunchOutSetupRequest from a buyer's
 * procurement system. Authenticates the Sender credential against the
 * company's punchout connection and answers with a one-time StartPage URL
 * (/punchout/<token>, valid for 2 hours).
 */
export async function POST(request: Request) {
  try {
    const root = await readCxml(request);
    const connection = await authenticate(senderOf(root));
    const setup = parseSetupRequest(root);
    const token = await startSession(connection, setup);
    const startPage = new URL(`/punchout/${token}`, siteUrl(new URL(request.url).origin)).toString();
    return xmlResponse(setupResponse(payloadId(), timestamp(), startPage));
  } catch (err) {
    return cxmlFailure("api/punchout/setup", err);
  }
}
