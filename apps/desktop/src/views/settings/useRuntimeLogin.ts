import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { useStableCallback } from '../../hooks/useStableCallback'

import { authorizeUrl, devicePage } from './runtimeLogin'

import type { RuntimeInstance, RuntimeLoginStatus } from '../../types/runtime'

const activeStates = new Set(['starting', 'awaiting_authorization'])

/** A team agent's sign-in, from waiting for it to answer to connected. Shared by Settings and onboarding. */
export function useRuntimeLogin(
  teamId: string,
  instance: RuntimeInstance,
  onConnected: () => void,
) {
  const [login, setLogin] = useState<RuntimeLoginStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [closing, setClosing] = useState(false)
  const [reachable, setReachable] = useState(false)
  // Reuse the start request across StrictMode's effect replay: every start replaces the
  // agent's previous sign-in.
  const request = useRef<Promise<RuntimeLoginStatus> | null>(null)
  const complete = useStableCallback(() => {
    window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
    onConnected()
  })

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const receive = (status: RuntimeLoginStatus) => {
      if (stopped) return
      setLogin(status)
      setError(null)
      if (status.state === 'connected') {
        stopped = true
        complete()
      } else if (activeStates.has(status.state)) timer = setTimeout(poll, 2_000)
    }
    const poll = () => {
      void api.atlasGetRuntimeLogin(teamId, instance.id).then(receive, () => {
        if (stopped) return
        setError('Could not check sign-in status. Retrying…')
        timer = setTimeout(poll, 3_000)
      })
    }

    const start = () => {
      setReachable(true)
      request.current ??= api.atlasStartRuntimeLogin(teamId, instance.id)
      void request.current.then(receive, (cause: unknown) => {
        if (!stopped) {
          setError('Could not start sign-in. Please try again.')
          toast.apiError('Could not start sign-in', cause)
        }
      })
    }
    // A just-created agent is still starting; sign-in needs it to answer first.
    const whenReachable = () => {
      void api.atlasGetRuntimeInstanceStatus(teamId, instance.id).then(
        (status) => {
          if (stopped) return
          if (status.online) start()
          else timer = setTimeout(whenReachable, 2_000)
        },
        () => {
          if (!stopped) timer = setTimeout(whenReachable, 3_000)
        },
      )
    }

    if (request.current) start()
    else whenReachable()

    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [teamId, instance.id, retry, complete])

  /** Cancels an attempt still in progress. False when cancelling failed and the caller should stay. */
  async function cancel(): Promise<boolean> {
    if (closing) return false
    setClosing(true)
    try {
      // A start still in flight has an attempt too; it must not outlive the caller.
      const current = login ?? (await request.current?.catch(() => null))

      if (current && activeStates.has(current.state))
        await api.atlasCancelRuntimeLogin(teamId, instance.id, current.attemptId)

      return true
    } catch (cause) {
      toast.apiError('Could not cancel sign-in', cause)

      return false
    } finally {
      setClosing(false)
    }
  }
  function restart() {
    request.current = null
    setReachable(false)
    setLogin(null)
    setError(null)
    setRetry((value) => value + 1)
  }
  async function submitCode(code: string) {
    if (login)
      setLogin(await api.atlasSubmitRuntimeLoginCode(teamId, instance.id, login.attemptId, code))
  }

  const awaiting = login?.state === 'awaiting_authorization'

  return {
    login,
    error,
    reachable,
    closing,
    retry,
    awaiting,
    authorizationUrl: awaiting
      ? authorizeUrl(instance.provider, login.authorizationUrl)
      : undefined,
    verificationUri: awaiting ? devicePage(instance.provider, login.verificationUri) : undefined,
    failed: login?.state === 'failed' || login?.state === 'cancelled' || (!login && Boolean(error)),
    cancel,
    restart,
    submitCode,
  }
}

export type RuntimeLogin = ReturnType<typeof useRuntimeLogin>
