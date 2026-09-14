import * as React from "react"

const LG_BREAKPOINT = 1024

/** Mirrors Tailwind's `lg` breakpoint for JS-side layout decisions. */
export function useIsLg() {
  const [isLg, setIsLg] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`)
    const onChange = () => {
      setIsLg(window.innerWidth >= LG_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    // eslint-disable-next-line react/set-state-in-effect
    setIsLg(window.innerWidth >= LG_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isLg
}
