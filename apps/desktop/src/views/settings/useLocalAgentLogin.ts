import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { useLocalRuntimeState } from '../../hooks/useLocalRuntimeState'

import type { LocalAgentLoginState, LocalAgentProvider } from '../../api'

function useFailureToast(name: string, login: LocalAgentLoginState | undefined, notify: boolean) {
  const previous = useRef(login?.state)

  useEffect(() => {
    const justFailed = login?.state === 'failed' && previous.current !== 'failed'

    previous.current = login?.state
    if (notify && justFailed)
      toast.error(`${name} sign-in failed`, login.error ?? 'Please try signing in again.')
  }, [notify, login?.state, login?.error, name])
}

/**
 * Starting, following and cancelling this computer's sign-in for one local agent.
 * `notify` reports a failure that happens while the caller is showing the sign-in.
 */
export function useLocalAgentLogin(provider: LocalAgentProvider, notify: boolean) {
  const state = useLocalRuntimeState()
  const [failed, setFailed] = useState(false)
  const [starting, setStarting] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const codex = provider === 'codex'
  const name = codex ? 'Codex' : 'Claude'
  const login = codex ? state?.codexLogin : state?.claudeLogin
  const busy = starting || login?.state === 'waiting' || login?.state === 'checking'
  // A failure from an earlier, unrelated attempt is not this caller's to report.
  const retry = attempted && (failed || login?.state === 'failed')

  useFailureToast(name, login, notify)

  async function start() {
    setFailed(false)
    setStarting(true)
    setAttempted(true)
    try {
      await (codex ? api.localRuntimeStartCodexLogin() : api.localRuntimeStartClaudeLogin())
    } catch (err) {
      setFailed(true)
      toast.apiError(`Could not start ${name} sign-in`, err)
    } finally {
      setStarting(false)
    }
  }

  /** Cancels a running attempt. False when cancelling failed and the caller should stay. */
  async function cancel(): Promise<boolean> {
    try {
      if (busy)
        await (codex ? api.localRuntimeCancelCodexLogin() : api.localRuntimeCancelClaudeLogin())

      return true
    } catch (err) {
      toast.apiError(`Could not cancel ${name} sign-in`, err)

      return false
    }
  }

  /** Picks up an attempt already in flight, or starts clean. */
  function resume() {
    setAttempted(login?.state === 'waiting' || login?.state === 'checking')
    setFailed(false)
  }

  return {
    name,
    codex,
    login,
    busy,
    retry,
    connected: attempted && !starting && login?.state === 'connected',
    start,
    cancel,
    resume,
  }
}
