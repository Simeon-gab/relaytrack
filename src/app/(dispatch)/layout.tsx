// Dispatch is dark by default — control-room feel. SPEC.md section 4.
export default function DispatchLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark min-h-screen bg-base text-neutral-100">{children}</div>
  );
}
