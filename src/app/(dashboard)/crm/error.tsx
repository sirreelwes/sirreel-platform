'use client'

/**
 * Route-level error boundary for /crm — a final backstop. Any render
 * throw not caught by an in-page <ErrorBoundary> degrades to this inline
 * card instead of Next's white-screen "Application error". The dashboard
 * layout (nav/sidebar) stays mounted; only the page body is replaced.
 */

export default function CrmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="p-6 max-w-2xl">
      <div className="border border-chip-bad-fg/30 bg-chip-bad-bg/30 rounded-xl p-5">
        <h2 className="text-base font-semibold text-chip-bad-fg">Something went wrong on the CRM page.</h2>
        <p className="text-sm text-lt-fg2 mt-1 break-words">{error.message || 'Unexpected error.'}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-3 px-3 py-1.5 text-sm font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
