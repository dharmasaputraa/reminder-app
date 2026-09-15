import type { ReactNode } from 'react'

/** Section of a docked right panel: hairline divider, label, content below —
 *  the chrome shared by the contacts detail and the agenda event detail, so
 *  both right panels read the same. */
export function PanelSection({
  title,
  children,
  className = 'px-4 py-4',
}: {
  title: string
  children: ReactNode
  /** Replaces the default padding — the edit dialog passes "pt-4" because
   *  DialogContent already pads its content. */
  className?: string
}) {
  return (
    <section className={`border-t ${className}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3 space-y-2.5">{children}</div>
    </section>
  )
}

/** Read-only fact row: muted label left, value right — one row style for
 *  every right panel. Expects a text-sm ancestor (all panels set one). */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="min-w-0 text-right font-medium">{children}</span>
    </div>
  )
}
