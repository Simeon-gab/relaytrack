import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // RLS tests hit the live Supabase project over the network.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
