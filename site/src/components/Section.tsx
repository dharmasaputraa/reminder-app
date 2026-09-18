import type { ReactNode } from "react";

export function Section({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="mx-auto w-full max-w-[1200px] scroll-mt-24 px-6 py-[96px]"
    >
      {children}
    </section>
  );
}
