"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function MagicLinkForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Invite flow: only pre-created rider accounts may sign in.
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/rider`,
      },
    });
    if (otpError) {
      setError("Could not send the link. Check the email or ask your dispatcher.");
      setBusy(false);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <p className="mt-6 rounded border border-success/40 bg-success/10 p-4 text-sm">
        Link sent. Open the email on this phone and tap the link to sign in.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
      <label className="text-sm font-medium" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded border border-neutral-300 px-3 py-3 text-lg"
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="mt-2 min-h-14 rounded bg-base px-4 py-3 text-lg font-medium text-white disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send sign-in link"}
      </button>
    </form>
  );
}
