import * as React from "react"

const LG_BREAKPOINT = 1024

/** Mirrors Tailwind's `lg` breakpoint for JS-side layout decisions. */
export function useIsLg() {
  // Lazy initializer: read the real width on the FIRST render. If a pane /
  // viewport settles late, the mount effect could otherwise capture a
  // transient small width and no later `change` event would correct it —
  // locking layout decisions (docked panel vs. navigation) to the wrong
  // branch for the whole session.
  const [isLg, setIsLg] = React.useState<boolean>(() =>
    window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`).matches
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`)
    const sync = () => setIsLg(mql.matches)
    // mql 'change' alone is not enough: an embedded pane that materializes
    // at width 0 and grows afterwards may cross the breakpoint without a
    // change/resize event reaching the page (seen in in-app browsers).
    // ResizeObserver on <html> catches that growth — the layout box changes
    // even when the window-level events are swallowed.
    const ro = new ResizeObserver(sync)
    ro.observe(document.documentElement)
    mql.addEventListener("change", sync)
    window.addEventListener("resize", sync)
    sync()
    return () => {
      ro.disconnect()
      mql.removeEventListener("change", sync)
      window.removeEventListener("resize", sync)
    }
  }, [])

  return isLg
}
