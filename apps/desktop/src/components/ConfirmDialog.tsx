import { AppAlertDialog } from './ui/alert-dialog'

import type { ReactNode } from 'react'

type Props = {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onClose,
}: Props) {
  return (
    <AppAlertDialog
      open={open}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      destructive={destructive}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )
}
