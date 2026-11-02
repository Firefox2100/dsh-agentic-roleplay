import type { ReactNode } from 'react'

export type Shown<E> = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; entries: readonly E[] }

/** The frame every page of the reference shares: loading, failure and nothing-yet look the same. */
export function Page<E>({ reading, empty, failed, loading, children, className }: { reading: Shown<E>; empty: string | undefined; failed: (message: string) => string | undefined; loading: string | undefined; className: string; children: (entries: readonly E[]) => ReactNode }): ReactNode {
  if (reading.state === 'loading') return <p className={className}>{loading}</p>
  if (reading.state === 'failed') return <p className={className} role="alert">{failed(reading.message)}</p>
  return reading.entries.length === 0 ? <p className={className}>{empty}</p> : <>{children(reading.entries)}</>
}
