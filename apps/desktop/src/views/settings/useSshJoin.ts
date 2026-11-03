import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { sshJoinNotice } from './sshJoinPresentation'

import type { SshJoinProblem } from '../../api/device-types'

const POLL_MS = 2_000
const ONLINE_TIMEOUT_MS = 2 * 60_000

export type SshJoinPhase = 'idle' | 'connecting' | 'waiting' | 'online'

/**
 * Connects a machine over the user's own ssh, then waits for it to come online as a computer.
 * Closing the dialog stops a run still in ssh; failures are toasts, with ssh's output kept.
 */
export function useSshJoin() {
  const [phase, setPhase] = useState<SshJoinPhase>('idle')
  const [output, setOutput] = useState('')
  const [computer, setComputer] = useState<string | null>(null)
  const run = useRef<string | null>(null)

  useEffect(
    () => () => {
      if (run.current) void api.sshJoinCancel(run.current)
      run.current = null
    },
    [],
  )

  const connect = async (host: string) => {
    const id = crypto.randomUUID()
    const current = () => run.current === id
    const fail = (problem: SshJoinProblem | 'timeout') => {
      const notice = sshJoinNotice(problem, host)

      toast.error(notice.title, notice.description)
      setPhase('idle')
    }
    const off = api.onSshJoinOutput((from, text) => {
      if (from === id) setOutput((previous) => previous + text)
    })

    run.current = id
    setPhase('connecting')
    setOutput('')
    setComputer(null)
    try {
      const result = await api.sshJoin(id, host)

      if (!current()) return
      if (!result.ok) return fail(result.problem)
      setPhase('waiting')
      for (const deadline = Date.now() + ONLINE_TIMEOUT_MS; Date.now() < deadline;) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        if (!current()) return
        const device = (await api.boxListDevices()).devices.find(
          (candidate) => candidate.deviceId === result.deviceId && candidate.online,
        )

        if (device) {
          setComputer(device.label)
          setPhase('online')

          return
        }
      }
      if (current()) fail('timeout')
    } catch (error) {
      if (!current()) return
      toast.apiError(t('Could not connect the computer'), error)
      setPhase('idle')
    } finally {
      off()
      if (current()) run.current = null
    }
  }

  return { phase, output, computer, connect }
}
