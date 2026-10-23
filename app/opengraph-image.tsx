import { ImageResponse } from "next/og";

// Link preview for WhatsApp, Slack, LinkedIn: plum card, linen wordmark, coral accent.
// Hex here because ImageResponse can't read CSS variables; mirrors globals.css.
export const alt = "Lufer.ai: corporate events and hospitality for India";
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
          background: "radial-gradient(900px 500px at 100% 0%, rgba(255,107,74,0.35), transparent), #2A1B3D",
          color: "#FAF6F0",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", fontSize: 64, fontWeight: 700 }}>
          Lufer<span style={{ color: "#FF6B4A", fontSize: 36 }}>.ai</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>
            Team offsites, client dinners and events, booked in minutes.
          </div>
          <div style={{ marginTop: 28, fontSize: 30, color: "#C9BEDA" }}>
            Direct venue quotes · WhatsApp approvals · GST invoices with ITC
          </div>
        </div>
      </div>
    ),
    size,
  );
}
