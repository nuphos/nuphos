import { useEffect, useState } from 'react'

import { api } from '../api'
import { t } from '../i18n'
import { onStepUp } from '../lib/stepUp'

import { MfaCodeForm } from './MfaCodeForm'
import { Modal } from './Modal'

import type { ReactNode } from 'react'

/** A dialog that asks for an authenticator or recovery code before an action. */
export function MfaCodeDialog({
  open,
  title,
  description,
  submitLabel,
  onSubmit,
  onClose,
}: {
  open: boolean
  title: string
  description: ReactNode
  submitLabel: string
  /** Throws when the code is refused, which keeps the dialog open. */
  onSubmit: (code: string) => Promise<void>
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      appearance="prompt"
      width={400}
      // A stray click must not drop a code that is being checked.
      closeOnBackdrop={false}
    >
      {open && <MfaCodeForm submitLabel={submitLabel} onSubmit={onSubmit} />}
    </Modal>
  )
}

/**
 * Answers step-up requests from any API call (lib/stepUp.ts): asks for a code,
 * confirms it with the backend, and lets the call run again. Mounted once.
 */
export function StepUpPrompt() {
  const [resolve, setResolve] = useState<((ok: boolean) => void) | null>(null)

  useEffect(() => {
    onStepUp(() => new Promise<boolean>((done) => setResolve(() => done)))

    return () => onStepUp(null)
  }, [])

  function finish(ok: boolean) {
    resolve?.(ok)
    setResolve(null)
  }

  return (
    <MfaCodeDialog
      open={resolve !== null}
      title={t('Confirm it’s you')}
      description={t('Enter a code from your authenticator app to continue.')}
      submitLabel={t('Continue')}
      onSubmit={async (code) => {
        await api.atlasReauthMfa(code)
        finish(true)
      }}
      onClose={() => finish(false)}
    />
  )
}
