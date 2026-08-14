import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

// Typography: Inter (UI) + single display weight of Space Grotesk for
// numbers/status. SPEC.md section 4.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: "500",
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "RelayTrack",
  description: "Delivery operations for businesses that deliver with their own riders.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="bg-white font-sans text-base-ink antialiased">{children}</body>
    </html>
  );
}
