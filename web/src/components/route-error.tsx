import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { Button, buttonVariants } from '@/components/ui/button'
import { pageTitle } from '@/lib/page-title'

/** Router-wide error UI (defaultErrorComponent): any route that throws and
 *  doesn't define its own errorComponent renders here, inside the app shell. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  useEffect(() => {
    document.title = pageTitle('Error')
  }, [])

  const message = error instanceof Error ? error.message : String(error)

  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center gap-3 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <TriangleAlert className="size-6 text-destructive" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          An unexpected error occurred while loading this page. Try again, or
          head back to the dashboard.
        </p>
      </div>
      {message && (
        <p className="mx-auto max-w-md rounded-xl border bg-card px-4 py-3 break-words font-mono text-sm text-start text-muted-foreground">
          {message}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <Button onClick={() => reset()}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
        <Link to="/reminder" className={buttonVariants({ variant: 'outline' })}>
          Back to Dashboard
        </Link>
      </div>
    </section>
  )
}
