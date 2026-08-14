import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // These tests hit the live Supabase project over the network.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
