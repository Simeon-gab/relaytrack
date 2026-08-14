import { describe, it, expect } from "vitest";

/**
 * Org isolation is the gate on every phase (SPEC.md section 0, definition of done).
 * A user in org A must not be able to read a single row belonging to org B —
 * on any table, through any client path.
 *
 * Phase 1 implements this. Until then it fails loudly, on purpose.
 */
describe("RLS org isolation", () => {
  it("org A user cannot read org B rows", async () => {
    expect.fail("Not implemented (Phase 1) — do not mark Phase 1 done until this passes.");
  });

  it("rider cannot read another rider's deliveries or locations", async () => {
    expect.fail("Not implemented (Phase 1)");
  });

  it("expired tracking token is rejected", async () => {
    expect.fail("Not implemented (Phase 5)");
  });

  it("unsigned location ingest POST is rejected with 401", async () => {
    expect.fail("Not implemented (Phase 3)");
  });

  it("replayed webhook timestamp is rejected by the receiver", async () => {
    expect.fail("Not implemented (Phase 8)");
  });
});
