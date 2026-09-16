import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { Compass } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { pageTitle } from '@/lib/page-title'

/** Router-wide not-found UI (defaultNotFoundComponent): unknown URLs and
 *  thrown notFound() states render here, inside the app shell. */
export function RouteNotFound() {
  useEffect(() => {
    document.title = pageTitle('Page not found')
  }, [])

  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center gap-3 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Compass className="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="text-xl font-bold">Page not found</h1>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          The page you’re looking for doesn’t exist or may have been moved.
        </p>
      </div>
      <Link to="/reminder" className={buttonVariants({ className: 'mt-2' })}>
        Back to Dashboard
      </Link>
    </section>
  )
}
