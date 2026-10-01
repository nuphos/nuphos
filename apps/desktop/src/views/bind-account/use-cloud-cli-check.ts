import { useEffect, useState } from 'react'

import { api } from '../../api'
import { isCloudCliProvider } from '../../lib/cloudCli'
import { useResetOnKey } from '../useResetOnKey'

import type { CloudCliProbe } from '../../lib/cloudCli'

type Check = { key: string; result: CloudCliProbe | null }

export function useCloudCliCheck(active: boolean, provider: string | null, scopeKey: string) {
  const key = `${scopeKey}:${String(active)}:${provider ?? ''}`
  const [check, setCheck] = useState<Check | null>(null)
  const [versionAttempt, setVersionAttempt] = useState(0)
  const [version, setVersion] = useState<{
    key: string
    attempt: number
    value: string | null
  } | null>(null)
  const [manual, setManual] = useState(false)
  const supported = provider !== null && isCloudCliProvider(provider)

  useResetOnKey(key, () => {
    setVersionAttempt(0)
    setVersion(null)
    setCheck(null)
    setManual(false)
  })
  useEffect(() => {
    if (!active || !supported || manual) return
    let cancelled = false
    const finish = (result: CloudCliProbe | null) => {
      if (!cancelled) setCheck({ key, result })
    }
    const timeout = window.setTimeout(() => {
      finish(null)
      cancelled = true
    }, 15_000)

    void api
      .cloudProbeCli(provider)
      .then(finish, () => finish(null))
      .finally(() => window.clearTimeout(timeout))

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [active, supported, provider, key, manual])

  const current = check?.key === key ? check : null

  const installed = Boolean(current?.result?.installed)

  useEffect(() => {
    if (!active || !supported || manual || !installed || versionAttempt === 0) return
    let cancelled = false
    const finish = (value: string | null) => {
      if (!cancelled) setVersion({ key, attempt: versionAttempt, value })
    }
    const timeout = window.setTimeout(() => {
      finish(null)
      cancelled = true
    }, 15_000)

    void api
      .cloudProbeCliVersion(provider, current?.result?.probeId)
      .then(finish, () => finish(null))
      .finally(() => window.clearTimeout(timeout))

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [
    active,
    supported,
    manual,
    installed,
    provider,
    key,
    versionAttempt,
    current?.result?.probeId,
  ])

  const currentVersion = version?.key === key && version.attempt === versionAttempt ? version : null

  return {
    versionRequested: versionAttempt > 0,
    versionLoading: installed && versionAttempt > 0 && currentVersion === null,
    retryVersion: () => setVersionAttempt((attempt) => attempt + 1),
    visible: active && supported && !manual && (!current || Boolean(current.result?.installed)),
    checking: current === null,
    result: current?.result ? { ...current.result, version: currentVersion?.value ?? null } : null,
    continueManually: () => setManual(true),
  }
}
