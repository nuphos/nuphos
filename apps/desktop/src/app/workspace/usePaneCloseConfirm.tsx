import { useState } from 'react'

import { ConfirmDialog } from '../../components/ConfirmDialog'

import { paneTerminalCount } from './paneTerminals'

import type { WorkspaceStore } from './store/workspaceStore'

/**
 * Closing a pane also closes its dock tabs. When that would stop a terminal,
 * ask first: a long command running there is easy to lose by accident.
 */
export function usePaneCloseConfirm(
  stores: Map<string, WorkspaceStore>,
  multiple: boolean,
  close: (id: string) => void,
) {
  const [pending, setPending] = useState<{ id: string; terminals: number } | null>(null)

  const request = (id: string) => {
    const state = stores.get(id)?.getState()
    // The last pane only returns to a blank chat and keeps its tabs.
    const terminals = multiple && state ? paneTerminalCount(state) : 0

    if (terminals === 0) close(id)
    else setPending({ id, terminals })
  }

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title="Close this pane?"
      description={
        pending?.terminals === 1
          ? 'Its terminal will close, and anything still running in it will stop. The agent stays in the sidebar.'
          : `Its ${String(pending?.terminals ?? 0)} terminals will close, and anything still running in them will stop. The agent stays in the sidebar.`
      }
      confirmLabel="Close pane"
      destructive
      onConfirm={() => {
        if (pending) close(pending.id)
        setPending(null)
      }}
      onClose={() => setPending(null)}
    />
  )

  return { request, dialog }
}
