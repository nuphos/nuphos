import { ShieldCheck } from 'lucide-react'

export function LoadMore({
  visible,
  loading,
  onClick,
}: {
  visible: boolean
  loading: boolean
  onClick: () => void
}) {
  if (!visible) return null

  return (
    <div className="flex-shrink-0 border-t border-zGray-800/60 px-6 py-3">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="w-full rounded border border-zGray-800/60 px-3 py-2 text-[12px] text-secondary hover:border-zGray-700/60 hover:text-main disabled:opacity-50"
      >
        {loading ? 'Loading…' : 'Load more'}
      </button>
    </div>
  )
}

export function SearchScopeHint({ hasMore }: { hasMore: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-14 text-center">
      <div className="text-[13px] text-secondary">No matches in the loaded rows.</div>
      <div className="max-w-[420px] text-[11.5px] leading-4 text-tertiary">
        Search covers rows already loaded on this page
        {hasMore ? ' — use “Load more” to widen the search window.' : '.'}
      </div>
    </div>
  )
}

export function EmptyState({ mutationsOnly }: { mutationsOnly: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-center">
      <ShieldCheck className="h-6 w-6 text-tertiary" strokeWidth={1.5} />
      <div className="text-[13px] text-secondary">
        {mutationsOnly ? 'No mutations in this window.' : 'No audit activity in this window.'}
      </div>
      <div className="max-w-[420px] text-[11.5px] leading-4 text-tertiary">
        Agent turns and shared-skill mutations appear here as activity occurs.
      </div>
    </div>
  )
}
