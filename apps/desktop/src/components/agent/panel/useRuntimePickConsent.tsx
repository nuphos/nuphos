import { useState } from 'react'

import { t } from '../../../i18n'
import { localAgentMoveWarning } from '../../../lib/localAgentSharing'
import { ConfirmDialog } from '../../ConfirmDialog'

import type { RuntimeInstance } from '../../../types/runtime'

/** Existing conversations already ask before moving; new picks need their own notice. */
export function useRuntimePickConsent({
  options,
  sessionId,
  onSelect,
  closeMenu,
}: {
  options: RuntimeInstance[]
  sessionId?: string
  onSelect?: (runtimeId: string) => void
  closeMenu: () => void
}) {
  const [pending, setPending] = useState<RuntimeInstance | null>(null)
  const pick = (runtimeId: string) => {
    const target = options.find((instance) => instance.id === runtimeId)

    if (!sessionId && target?.local && (target.local.shared || target.local.box)) {
      closeMenu()
      setPending(target)
    } else onSelect?.(runtimeId)
  }

  return {
    onSelect: onSelect ? pick : undefined,
    dialog: pending && (
      <ConfirmDialog
        open
        title={pending.local?.deviceLabel ?? pending.label}
        description={localAgentMoveWarning(pending)}
        confirmLabel={t('Confirm')}
        onConfirm={() => {
          onSelect?.(pending.id)
          setPending(null)
        }}
        onClose={() => setPending(null)}
      />
    ),
  }
}
