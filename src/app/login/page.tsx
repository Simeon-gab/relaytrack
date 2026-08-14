import { LoginForm } from "./login-form";

// Dispatcher/owner/admin sign-in. Email + password (SPEC.md section 2, auth model).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="font-display text-2xl">RelayTrack</h1>
      <p className="mt-1 text-sm opacity-60">Sign in to your dispatch dashboard.</p>
      <LoginForm next={next ?? "/dispatch"} />
    </main>
  );
}
