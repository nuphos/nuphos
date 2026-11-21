import { X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { useToolbarSlot } from '../../hooks/useToolbarControls'
import { t } from '../../i18n'

import type { InboxQuestion } from './inboxItems'

/**
 * "Dismiss all" in the Inbox page's header, beside its search and count, for
 * the questions it shows when there is more than one. It asks first; while it
 * asks, the Inbox's own keys rest, so a digit cannot answer the question behind.
 */
export function DismissAllButton({
  questions = [],
  active,
  confirming,
  onConfirming,
  onConfirm,
}: {
  /** The questions the Inbox shows; undefined while it loads. */
  questions?: readonly InboxQuestion[]
  active: boolean
  confirming: boolean
  onConfirming: (open: boolean) => void
  onConfirm: (questions: readonly InboxQuestion[]) => void
}) {
  const count = questions.length
  const slot = useToolbarSlot('right', active && count > 1)

  // Nothing left to dismiss all of, as when they were answered meanwhile in a chat: it stops asking.
  useEffect(() => {
    if (confirming && count < 2) onConfirming(false)
  }, [confirming, count, onConfirming])

  if (!slot) return null

  return createPortal(
    <>
      <Button
        variant="secondary"
        size="sm"
        className="h-7 flex-shrink-0 gap-1.5 px-2.5 text-[12px]"
        onClick={() => onConfirming(true)}
      >
        <X className="size-3.5" aria-hidden />
        {t('Dismiss all')}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={t('Dismiss {n} questions?', { n: count })}
        description={t("Each Bot or Task that asked is told you won't answer.")}
        confirmLabel={t('Dismiss all')}
        onConfirm={() => onConfirm(questions)}
        onClose={() => onConfirming(false)}
      />
    </>,
    slot,
  )
}
