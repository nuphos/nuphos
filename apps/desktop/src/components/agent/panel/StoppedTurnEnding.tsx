import { Square } from 'lucide-react'

/** Closes a turn the user stopped, in the muted style of the fold header. */
export function StoppedTurnEnding({ calls }: { calls: number }) {
  return (
    <div className="flex items-center gap-1.5 text-[12.5px] text-tertiary">
      <Square className="h-2.5 w-2.5" strokeWidth={2} fill="currentColor" aria-hidden="true" />
      Stopped by you
      {calls > 0 && (
        <span className="text-tertiary/70">
          · {String(calls)} {calls === 1 ? 'call' : 'calls'}
        </span>
      )}
    </div>
  )
}
