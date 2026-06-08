import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'

/**
 * Wraps a federated remote import (which may fail if the remote is unreachable)
 * in lazy-loading + Suspense, with a friendly fallback if the remote can't load.
 */
export function remotePage<T extends object>(
  loader: () => Promise<T>,
  pick: (mod: T) => ComponentType,
): () => ReactNode {
  const Lazy = lazy(() =>
    loader()
      .then((mod) => ({ default: pick(mod) }))
      .catch(() => ({
        default: () => (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-muted">
            <p>This section is temporarily unavailable.</p>
            <p className="text-sm">The remote micro-frontend could not be loaded.</p>
          </div>
        ),
      })),
  )

  return function RemotePage() {
    return (
      <Suspense fallback={<div className="flex h-64 items-center justify-center text-muted">Loading…</div>}>
        <Lazy />
      </Suspense>
    )
  }
}
