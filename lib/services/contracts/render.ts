/**
 * Renders a contract to a self-contained, print-ready HTML document (browsers
 * save it as PDF) and fingerprints it. The issued HTML is stored with its
 * SHA-256 and never re-rendered: signatures cover those exact bytes, and the
 * export appends the signature certificate outside them.
 *
 * Every interpolated value is HTML-escaped.
 *
 * Pure: tests import it directly (tests/contracts.test.mjs).
 */

import { createHash } from "node:crypto";

import { sections, TEMPLATE, type Block } from "./template.ts";
import type { ContractTerms } from "./terms.ts";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const STYLE = `
  :root { color-scheme: light; }
  body { font: 14px/1.55 Georgia, "Times New Roman", serif; color: #1c1917; background: #fff; max-width: 46rem; margin: 2.5rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.35rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
  h2 { font-size: 1rem; margin: 1.75rem 0 .5rem; }
  .meta { color: #57534e; font: 12px/1.5 ui-monospace, Menlo, monospace; margin-bottom: 1.5rem; }
  table { width: 100%; border-collapse: collapse; margin: .5rem 0; }
  td { border-top: 1px solid #e7e5e4; padding: .4rem .25rem; vertical-align: top; }
  td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  ul { padding-left: 1.2rem; margin: .5rem 0; }
  li { margin: .25rem 0; }
  .certificate { margin-top: 2.5rem; padding-top: 1rem; border-top: 2px solid #1c1917; break-before: page; }
  .certificate td:last-child { text-align: left; font: 12px/1.5 ui-monospace, Menlo, monospace; word-break: break-all; }
  @page { margin: 18mm; }
  @media print { body { margin: 0 auto; } }
`;

function block(b: Block): string {
  switch (b.kind) {
    case "p":
      return `<p>${escapeHtml(b.text)}</p>`;
    case "list":
      return `<ul>${b.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
    case "table":
      return b.rows.length ? `<table>${b.rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("")}</table>` : "";
  }
}

/** The document issued for signature. Same terms → same bytes → same hash. */
export function renderContract(terms: ContractTerms): { html: string; sha256: string; template: typeof TEMPLATE } {
  const body = sections(terms)
    .map((s) => `<section><h2>${escapeHtml(s.heading)}</h2>${s.blocks.map(block).join("")}</section>`)
    .join("");
  const title = `Venue Services Agreement ${terms.contractNumber}`;
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>` +
    `<h1>Venue Services Agreement</h1>` +
    `<div class="meta">${escapeHtml(`${terms.contractNumber} · revision ${terms.revision} · issued ${terms.issuedOn} · template ${TEMPLATE.key} v${TEMPLATE.version}`)}</div>` +
    body +
    `</body></html>`;
  return { html, sha256: sha256(html), template: TEMPLATE };
}

export interface CertificateSignature {
  /** client | venue */
  party: string;
  signer_name: string;
  signer_title: string | null;
  signer_email: string | null;
  signed_at: string;
  ip_address: string | null;
  document_sha256: string;
  provider_signature_id: string | null;
}

/**
 * The export: the issued document as stored, with a signature certificate
 * appended before </body>. The certificate lists the stored fingerprint and
 * whether the stored document still matches it.
 */
export function exportWithCertificate(contract: { document_html: string; document_sha256: string; status: string; provider: string }, signatures: readonly CertificateSignature[]): string {
  const intact = sha256(contract.document_html) === contract.document_sha256;
  const rows: [string, string][] = [
    ["Document SHA-256", contract.document_sha256],
    ["Integrity", intact ? "The document above matches this fingerprint." : "WARNING: the stored document does not match its fingerprint."],
    ["Status", contract.status.replace("_", " ")],
    ["Signed via", contract.provider === "dropbox_sign" ? "Dropbox Sign" : "Lufer.ai in-app signature"],
  ];
  const signed = signatures
    .slice()
    .sort((a, b) => (a.party === b.party ? 0 : a.party === "client" ? -1 : 1))
    .map(
      (s) =>
        `<h2>${s.party === "client" ? "Client" : "Venue"}</h2><table>${(
          [
            ["Signed by", `${s.signer_name}${s.signer_title ? `, ${s.signer_title}` : ""}`],
            ...(s.signer_email ? ([["Email", s.signer_email]] as [string, string][]) : []),
            ["Signed at", new Date(s.signed_at).toISOString()],
            ...(s.ip_address ? ([["IP address", s.ip_address]] as [string, string][]) : []),
            ["Document signed", s.document_sha256],
            ...(s.provider_signature_id ? ([["Provider signature", s.provider_signature_id]] as [string, string][]) : []),
          ] as [string, string][]
        )
          .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
          .join("")}</table>`
    )
    .join("");
  const certificate =
    `<section class="certificate"><h2>Signature certificate</h2><table>${rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("")}</table>` +
    (signed || `<p>${escapeHtml("Not signed yet.")}</p>`) +
    `</section>`;
  const at = contract.document_html.lastIndexOf("</body>");
  return at === -1 ? contract.document_html + certificate : contract.document_html.slice(0, at) + certificate + contract.document_html.slice(at);
}
