import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'
import clsx from 'clsx'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { reportFrontendError } from '../../lib/frontendErrorReporter'

import { Button } from './button'

import type { ReactNode } from 'react'

type AppAlertDialogProps = {
  open: boolean
  title: ReactNode
  description: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

export function AppAlertDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onClose,
}: AppAlertDialogProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Each opening starts from a clean slate. Adjusting during render (rather
  // than in an effect) keeps the previous run's error from flashing back up.
  const [wasOpen, setWasOpen] = useState(open)

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setPending(false)
      setError(null)
    }
  }

  async function runConfirmedAction() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      reportFrontendError({ source: 'alert_dialog', phase: 'confirm_failed', message }, err)
      setError(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onClose()
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Backdrop className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm opacity-100 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <AlertDialogPrimitive.Popup className="fixed left-1/2 top-1/2 z-[1001] flex w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-zGray-800 bg-zGray-900 shadow-2xl shadow-black/50 outline-none transition-[opacity,transform] duration-150 data-[ending-style]:-translate-y-[48%] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:-translate-y-[48%] data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
          <div className="flex items-start gap-3 px-5 py-4">
            <div
              className={clsx(
                'mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md',
                destructive ? 'bg-error/10 text-error' : 'bg-zViolet-500/15 text-zViolet-accent',
              )}
            >
              <AlertTriangle className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <AlertDialogPrimitive.Title className="text-[14px] font-semibold text-main">
                {title}
              </AlertDialogPrimitive.Title>
              <AlertDialogPrimitive.Description className="mt-1 text-[13px] leading-relaxed text-secondary">
                {description}
              </AlertDialogPrimitive.Description>
              {error && (
                <div className="mt-2 rounded-md border border-error/25 bg-error/10 px-2.5 py-2 text-[12.5px] leading-relaxed text-error">
                  {error}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-zGray-800 bg-zGray-900/60 px-5 py-3">
            <AlertDialogPrimitive.Close
              render={<Button type="button" variant="secondary" size="sm" />}
              disabled={pending}
            >
              {cancelLabel}
            </AlertDialogPrimitive.Close>
            <Button
              type="button"
              onClick={() => void runConfirmedAction()}
              disabled={pending}
              variant={destructive ? 'destructive' : 'primary'}
              size="sm"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
              {pending ? 'Working...' : confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}
