/** Fail fast on missing env vars — secrets live in env only (SPEC.md section 0, rule 6). */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
