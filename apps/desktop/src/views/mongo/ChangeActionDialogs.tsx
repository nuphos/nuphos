import { useState } from 'react'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'

import type { DatabaseChangeRequest } from '../../types'

export type PendingChangeAction = {
  action: 'approve' | 'reject' | 'execute'
  change: DatabaseChangeRequest
}

export function ChangeActionDialogs({
  pendingDecision,
  busy,
  onClose,
  onDecide,
  onExecute,
}: {
  pendingDecision: PendingChangeAction | null
  busy: boolean
  onClose: () => void
  onDecide: (
    action: 'approve' | 'reject',
    change: DatabaseChangeRequest,
    comment: string,
  ) => Promise<void>
  onExecute: (change: DatabaseChangeRequest) => Promise<void>
}) {
  const [comment, setComment] = useState('')
  const [previous, setPrevious] = useState(pendingDecision)

  if (previous !== pendingDecision) {
    setPrevious(pendingDecision)
    setComment('')
  }

  return (
    <>
      <ConfirmDialog
        open={pendingDecision?.action === 'execute'}
        title="Execute approved change?"
        description={
          pendingDecision
            ? `Execute ${pendingDecision.change.operation} on ${pendingDecision.change.database}.${pendingDecision.change.collection}? This will mutate the database using the stored credential.`
            : ''
        }
        confirmLabel="Execute"
        destructive
        onConfirm={async () => {
          if (pendingDecision) await onExecute(pendingDecision.change)
        }}
        onClose={onClose}
      />
      <Modal
        open={pendingDecision !== null && pendingDecision.action !== 'execute'}
        title={pendingDecision?.action === 'approve' ? 'Approve change' : 'Reject change'}
        description={pendingDecision?.change.title}
        onClose={() => {
          if (!busy) onClose()
        }}
        footer={
          <div className="flex justify-end gap-2 px-5 py-3">
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (!pendingDecision || pendingDecision.action === 'execute') return
                void onDecide(pendingDecision.action, pendingDecision.change, comment).then(onClose)
              }}
            >
              {pendingDecision?.action === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </div>
        }
      >
        <label className="block px-5 py-4 text-[12px] text-secondary">
          Comment (optional)
          <textarea
            autoFocus
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={busy}
            className="mt-2 w-full rounded-md border border-zGray-800 bg-field p-2 text-main"
          />
        </label>
      </Modal>
    </>
  )
}
