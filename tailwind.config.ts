import type { Config } from "tailwindcss";

// Tokens mirror docs/SPEC.md section 4 (Design system). Do not add colors ad hoc.
export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0A0A0B",
        "base-ink": "#0A0A0B",
        success: "#16A34A",
        transit: "#D97706",
        danger: "#DC2626",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Space Grotesk", "Inter", "sans-serif"],
      },
      borderRadius: { DEFAULT: "8px" },
    },
  },
  plugins: [],
} satisfies Config;
