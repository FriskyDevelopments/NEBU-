import type { ReactNode } from "react";

export function NebuShell({ left, center, right }: { left: ReactNode; center: ReactNode; right: ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.05fr_1.4fr_1.05fr]">
      <section className="min-w-0">{left}</section>
      <section className="min-w-0">{center}</section>
      <section className="min-w-0">{right}</section>
    </div>
  );
}
