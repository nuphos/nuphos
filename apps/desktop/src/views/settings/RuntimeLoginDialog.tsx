import { Modal } from '../../components/Modal'
import { toast } from '../../components/ui/toast'
import { AGENT_PROVIDER } from '../../types/runtime'

import { RuntimeLoginBody } from './RuntimeLoginBody'
import { loginButtonClasses as buttonClass } from './styles'
import { useRuntimeLogin } from './useRuntimeLogin'

import type { RuntimeInstance } from '../../types/runtime'

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
    >
      <div className="space-y-5 p-5" role="status" aria-live="polite">
        <RuntimeLoginBody instance={instance} state={state} />
        <div className="flex items-center gap-3">
          {state.failed && (
            <button type="button" onClick={state.restart} className={buttonClass}>
              Try again
            </button>
          )}
          <button
            type="button"
            disabled={state.closing}
            onClick={() => void close()}
            className="rounded-md px-3 py-2 text-[13px] text-secondary hover:bg-zGray-800/60 disabled:opacity-50"
          >
            {state.failed || !state.login ? 'Close' : 'Cancel sign-in'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
