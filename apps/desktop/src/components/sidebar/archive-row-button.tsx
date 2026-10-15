import { Archive } from 'lucide-react'

/** A chat row's hover-revealed archive control. */
export function ArchiveRowButton({ onArchive }: { onArchive: () => void }) {
  return (
    <span
      role="button"
      aria-label="Archive chat"
      title="Archive chat"
      onClick={(e) => {
        e.stopPropagation()
        onArchive()
      }}
      className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-tertiary hover:text-main hover:bg-[var(--sidebar-overlay-hover)]"
    >
      <Archive className="w-3.5 h-3.5" strokeWidth={1.8} />
    </span>
  )
}
