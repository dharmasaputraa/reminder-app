import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/contacts/$id')({ component: () => <p>Detail kontak (task 4)</p> })
