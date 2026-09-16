import { QueryClient } from '@tanstack/react-query'

/** Shared so route loaders can warm the same cache the components read
 *  (createFileRoute's loader context isn't typed in this setup). */
export const queryClient = new QueryClient()
