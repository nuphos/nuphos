import { useEffect, useRef } from 'react'

import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { AGENT_PROVIDER } from '../../types/runtime'

import { RuntimeLoginBody } from './RuntimeLoginBody'
import { useRuntimeLogin } from './useRuntimeLogin'

import type { RuntimeLogin } from './useRuntimeLogin'
import type { RuntimeInstance } from '../../types/runtime'

/** A sign-in's footer actions, for this dialog and for a flow that signs in as a step. */
export function RuntimeLoginActions({
  state,
  onClose,
}: {
  state: RuntimeLogin
  onClose: () => void
}) {
  return (
    <div className="flex justify-end gap-2 px-5 py-3">
      <Button size="sm" variant="secondary" disabled={state.closing} onClick={onClose}>
        {state.failed || !state.login ? t('Close') : t('Cancel sign-in')}
      </Button>
      {state.failed && (
        <Button size="sm" type="button" onClick={state.restart}>
          {t('Try again')}
        </Button>
      )}
    </div>
  )
}

export function RuntimeLoginDialog({
  teamId,
  instance,
  immediate,
  apiKey,
  onClose,
}: {
  teamId: string
  instance: RuntimeInstance
  /** Start sign-in right away; the backend waits for an agent that is still starting. */
  immediate?: boolean
  /** It is signed in with an API key now, which can be removed from here. */
  apiKey?: boolean
  /** `connected` is true when the sign-in succeeded. */
  onClose: (connected: boolean) => void
}) {
  const account = AGENT_PROVIDER[instance.provider].account
  const state = useRuntimeLogin(
    teamId,
    instance,
    () => {
      // An API key is not checked until a turn runs, so this names no sign-in method.
      toast.success(t('{name} is now signed in.', { name: instance.label }))
      onClose(true)
    },
    immediate,
    () => {
      toast.success(t('API key removed'), instance.label)
      onClose(false)
    },
  )
  // Focus starts in the sign-in, not on the page behind it (or the step before it).
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => body.current?.focus(), [])

  async function close() {
    if (await state.cancel()) onClose(false)
  }

  return (
    <Modal
      open
      onClose={() => void close()}
      title={t('Sign in with {account}', { account })}
      description={instance.label}
      closeOnBackdrop={false}
      footer={<RuntimeLoginActions state={state} onClose={() => void close()} />}
    >
      <div
        ref={body}
        tabIndex={-1}
        className="space-y-5 p-5 outline-none"
        role="status"
        aria-live="polite"
      >
        {apiKey && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line-control px-4 py-3">
            <p className="text-[13px] text-secondary">{t('Signed in with an API key.')}</p>
            <Button
              size="sm"
              variant="secondary"
              type="button"
              disabled={!state.awaiting || state.login?.codeSubmitted === true}
              onClick={() =>
                void state.submitCode('sign-out').catch((cause: unknown) => {
                  toast.apiError(t('Could not remove the API key'), cause)
                })
              }
            >
              {t('Remove API key')}
            </Button>
          </div>
        )}
        <RuntimeLoginBody instance={instance} state={state} />
      </div>
    </Modal>
  )
}
