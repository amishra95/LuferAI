import { ImageResponse } from "next/og";

import { DIYA_BOWL, DIYA_FLAME } from "@/components/brand/logo";

// iOS home-screen icon: the Diya mark in linen and coral on plum (iOS rounds the corners itself).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#111111" }}>
        <svg width="120" height="120" viewBox="0 0 64 64">
          <path d={DIYA_FLAME} fill="#FF4D1A" />
          <path d={DIYA_BOWL} fill="#F5F2EC" />
        </svg>
      </div>
    ),
    size,
  );
}
