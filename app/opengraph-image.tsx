import { ImageResponse } from "next/og";

import { DIYA_BOWL, DIYA_FLAME } from "@/components/brand/logo";

// Link preview for WhatsApp, Slack, LinkedIn: cream ground, ink wordmark, burnt-orange flame, the bill-book rule.
// Hex here because ImageResponse can't read CSS variables; mirrors globals.css.
export const alt = "Lufer: corporate events and hospitality in Bengaluru";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "#F3EBDD",
          color: "#1A1714",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 64, fontWeight: 700 }}>
          <svg width="72" height="72" viewBox="0 0 64 64">
            <path d={DIYA_FLAME} fill="#BF5700" />
            <path d={DIYA_BOWL} fill="#1A1714" />
          </svg>
          Lufer
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>
            Team offsites, client dinners and events, booked inside your policy
          </div>
          <div style={{ marginTop: 28, paddingTop: 24, borderTop: "3px solid #E2D6C2", fontSize: 30, color: "#5E564C" }}>
            Direct venue quotes · Approvals before spend · GST invoices
          </div>
        </div>
      </div>
    ),
    size,
  );
}
