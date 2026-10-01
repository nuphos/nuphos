import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { useState } from 'react'

import { ConfirmDialog } from './ConfirmDialog'

import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'

export type BulkAction = {
  key: string
  label: string
  icon?: IconDefinition
  onClick: () => void | Promise<void>
  // When set, clicking the action first shows a ConfirmDialog with this text
  // (same idiom as ContextMenuItem.confirm); onClick runs only on confirm.
  confirm?: string
  destructive?: boolean
  disabled?: boolean
}

/**
 * Floating action bar shown while ≥1 row is selected in a list. Renders the
 * selected count, the available bulk actions, and a clear button. Fixed to the
 * bottom-center of the window (above any view), Aptakube-style.
 */
export function BulkActionBar({
  count,
  actions,
  onClear,
}: {
  count: number
  actions: BulkAction[]
  onClear: () => void
}) {
  const [confirming, setConfirming] = useState<BulkAction | null>(null)
  // While an action's onClick is in flight every button is disabled, so a
  // double-click can't fire the same bulk mutation twice.
  const [busy, setBusy] = useState(false)

  if (count <= 0) return null

  async function run(action: BulkAction) {
    setBusy(true)
    try {
      await action.onClick()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ConfirmDialog
        open={confirming != null}
        title={confirming?.label ?? ''}
        description={confirming?.confirm ?? ''}
        confirmLabel={confirming?.label}
        destructive={confirming?.destructive}
        onConfirm={() => {
          const action = confirming

          setConfirming(null)
          if (action) void run(action)
        }}
        onClose={() => setConfirming(null)}
      />
      <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-1 rounded-lg border border-zGray-700 bg-zGray-900 px-2.5 py-1.5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]">
        <span className="px-1.5 text-[12.5px] text-secondary tabular-nums whitespace-nowrap">
          {count} selected
        </span>
        <div className="mx-1 h-4 w-px bg-zGray-700" />
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            disabled={action.disabled || busy}
            onClick={() => {
              if (action.confirm) setConfirming(action)
              else void run(action)
            }}
            className={clsx(
              'flex items-center gap-1.5 rounded px-2 py-1 text-[12.5px] whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              action.destructive ? 'text-error hover:bg-zGray-800' : 'text-main hover:bg-zGray-800',
            )}
          >
            {action.icon && <FontAwesomeIcon icon={action.icon} className="h-3 w-3" />}
            {action.label}
          </button>
        ))}
        <div className="mx-1 h-4 w-px bg-zGray-700" />
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="rounded p-1.5 text-tertiary transition-colors hover:bg-zGray-800 hover:text-secondary"
        >
          <FontAwesomeIcon icon={faXmark} className="h-3 w-3" />
        </button>
      </div>
    </>
  )
}
