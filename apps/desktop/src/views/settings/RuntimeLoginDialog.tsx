import { useEffect, useRef } from 'react'

import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
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
        {state.failed || !state.login ? 'Close' : 'Cancel sign-in'}
      </Button>
      {state.failed && (
        <Button size="sm" type="button" onClick={state.restart}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function RuntimeLoginDialog({
  teamId,
  instance,
  immediate,
  onClose,
}: {
  teamId: string
  instance: RuntimeInstance
  /** Start sign-in right away; the backend waits for an agent that is still starting. */
  immediate?: boolean
  /** `connected` is true when the sign-in succeeded. */
  onClose: (connected: boolean) => void
}) {
  const account = AGENT_PROVIDER[instance.provider].account
  const state = useRuntimeLogin(
    teamId,
    instance,
    () => {
      toast.success(`${account} connected`, `${instance.label} is now signed in.`)
      onClose(true)
    },
    immediate,
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
      title={`Sign in with ${account}`}
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
        <RuntimeLoginBody instance={instance} state={state} />
      </div>
    </Modal>
  )
}
