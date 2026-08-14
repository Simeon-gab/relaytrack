import { MagicLinkForm } from "./magic-link-form";

// Rider sign-in: magic link only, no passwords on a bike (SPEC.md section 2).
// Riders must already be invited (user created by their org) — the form does
// not create accounts.
export default function RiderLoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="font-display text-2xl">Rider sign-in</h1>
      <p className="mt-1 text-sm opacity-60">
        Enter the email your dispatcher registered. We send you a sign-in link —
        no password needed.
      </p>
      <MagicLinkForm />
    </main>
  );
}
