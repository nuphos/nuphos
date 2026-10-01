import { useEffect, useMemo, useState } from 'react'

import { MIN_RUNTIME_PASSWORD, runtimePasswordProblem } from './runtimePassword.ts'

import type { RuntimeInstance } from '../../types/runtime'

const DETECT_DEBOUNCE_MS = 600
const KEY_SEPARATOR = '\u0000'

function looksLikeAcpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())

    return url.protocol === 'wss:' || url.protocol === 'ws:'
  } catch {
    return false
  }
}

function passwordIsUsable(value: string): boolean {
  return value.length >= MIN_RUNTIME_PASSWORD && runtimePasswordProblem(value) === undefined
}

function detectionKey(url: string, password: string): string | null {
  const trimmedUrl = url.trim()
  const trimmedPassword = password.trim()

  if (!looksLikeAcpUrl(trimmedUrl) || !passwordIsUsable(trimmedPassword)) return null

  return `${trimmedUrl}${KEY_SEPARATOR}${trimmedPassword}`
}

/**
 * Debounced, best-effort agent detection for a runtime the operator has not
 * registered yet: once the address and password both look valid, probes the
 * runtime and reports what it found. `detecting` and `detectedProvider` are
 * both derived from the probe's result against the inputs that produced it,
 * so a still-changing form never shows a stale answer.
 */
export function useExternalRuntimeProviderDetection(
  url: string,
  password: string,
  onDetectProvider: (url: string, password: string) => Promise<RuntimeInstance['provider'] | null>,
): { detecting: boolean; detectedProvider: RuntimeInstance['provider'] | null } {
  const [detection, setDetection] = useState<{
    key: string
    provider: RuntimeInstance['provider'] | null
  } | null>(null)

  const detectKey = useMemo(() => detectionKey(url, password), [url, password])

  useEffect(() => {
    if (!detectKey) return
    const [trimmedUrl, trimmedPassword] = detectKey.split(KEY_SEPARATOR)

    if (!trimmedUrl || !trimmedPassword) return
    const timer = setTimeout(() => {
      onDetectProvider(trimmedUrl, trimmedPassword)
        .then((provider) => setDetection({ key: detectKey, provider }))
        .catch(() => setDetection({ key: detectKey, provider: null }))
    }, DETECT_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [detectKey, onDetectProvider])

  const resolution = detection !== null && detection.key === detectKey ? detection : null

  return {
    detecting: detectKey !== null && resolution === null,
    detectedProvider: resolution?.provider ?? null,
  }
}

export { detectionKey, looksLikeAcpUrl }
