import type { Metadata, Viewport } from "next";

// Rider surface is the installable PWA (manifest lives in /public).
export const metadata: Metadata = {
  title: "RelayTrack Rider",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#0A0A0B",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // no pinch-zoom surprises mid-delivery
};

export default function RiderLayout({ children }: { children: React.ReactNode }) {
  return children;
}
