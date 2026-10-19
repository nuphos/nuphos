import clsx from 'clsx'
import { CornerDownRight, ListPlus, LoaderCircle, X } from 'lucide-react'

import { fileNameFromPath } from './textUtils'

import type { QueuedMessage } from './model'

// This person's messages waiting in the session queue, in the order they run.
// Rendered between the conversation and the composer so the user can see what
// runs next and take back anything they no longer want.
export function QueuedStrip({
  items,
  onRemove,
  onSteer,
  sidebar = false,
  canSteer = false,
}: {
  items: QueuedMessage[]
  onRemove: (queuedId: string) => void
  onSteer: (queuedId: string) => void
  canSteer?: boolean
  sidebar?: boolean
}) {
  if (items.length === 0) return null

  return (
    <div className={clsx('mx-auto w-full', sidebar ? '' : 'max-w-[760px]')}>
      <div className="px-1 text-xs text-tertiary">Queued messages</div>
      <div className="flex flex-col gap-1.5 px-1 pb-1">
        {items.map((item, index) => {
          const label =
            item.text.trim() || item.filePaths.map(fileNameFromPath).join(', ') || 'Attachment'

          return (
            <div
              key={item.id}
              className="group flex items-center gap-2 rounded-lg border border-zGray-800/80 bg-zGray-900/60 px-2.5 py-1.5"
              title={label}
            >
              <ListPlus className="h-3.5 w-3.5 flex-shrink-0 text-tertiary" strokeWidth={2} />
              <span className="flex-shrink-0 text-[11px] tabular-nums text-tertiary">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-secondary">{label}</span>
              <span className="flex-shrink-0 text-[11px] text-tertiary">
                Runs after the turn ahead
              </span>
              {item.filePaths.length > 0 && (
                <span className="flex-shrink-0 text-[11px] text-tertiary">
                  {item.filePaths.length} file
                  {item.filePaths.length > 1 ? 's' : ''}
                </span>
              )}
              <button
                type="button"
                onClick={() => onSteer(item.id)}
                disabled={item.steering || !canSteer}
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-tertiary transition-colors enabled:hover:bg-zGray-800 enabled:hover:text-main disabled:opacity-40"
                title="Send into the running turn"
                aria-label="Send into the running turn"
              >
                {item.steering ? (
                  <LoaderCircle className="h-3 w-3 animate-spin" strokeWidth={2.2} />
                ) : (
                  <CornerDownRight className="h-3 w-3" strokeWidth={2.2} />
                )}
              </button>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-tertiary transition-colors hover:bg-zGray-800 hover:text-main"
                title="Take back"
                aria-label="Take back"
              >
                <X className="h-3 w-3" strokeWidth={2.2} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
