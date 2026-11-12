/** A group's name over its rows, as the sidebar titles its groups. */
export function GroupLabel({ text }: { text: string }) {
  return (
    <div className="px-2.5 pt-3 pb-1 text-[12.5px] text-tertiary" role="presentation">
      {text}
    </div>
  )
}

/** Placeholder rows hold the list's shape while it loads, so nothing jumps. */
export function ResultSkeleton() {
  return (
    <div aria-hidden className="space-y-0.5 px-2 pt-3">
      {[64, 48, 72, 56, 40].map((width) => (
        <div key={width} className="flex h-10 items-center gap-2.5 px-2.5">
          <span className="size-6 shrink-0 rounded-md bg-state-hover" />
          <span className="h-3 rounded bg-state-hover" style={{ width: `${String(width)}%` }} />
        </div>
      ))}
    </div>
  )
}
