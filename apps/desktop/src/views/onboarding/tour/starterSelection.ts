import type { LocalAgentProvider } from '../../../api/local-agent-providers.ts'
import type { RuntimeInstance } from '../../../types/runtime.ts'

/** Runtimes on this computer the first Bot may start on, best first. */
export const STARTER_LOCAL_PROVIDERS: readonly LocalAgentProvider[] = [
  'claude-code',
  'codex',
  'grok',
]

/** Where the first Bot runs; the screen never says which. */
export type StarterRuntime = { runtimeId: string; agentRuntime: string }

/** A runtime on `deviceId` that can take a Bot right now: online, signed in, working. */
export function usableRuntime(
  instance: RuntimeInstance,
  deviceId: string,
  provider: string,
): boolean {
  return (
    instance.local?.deviceId === deviceId &&
    instance.local.online !== false &&
    instance.local.signedIn !== false &&
    !instance.local.probeError &&
    instance.provider === provider &&
    instance.status === 'active' &&
    !instance.notReady &&
    !instance.deletion
  )
}

/** Claude Code, then Codex, then Grok Build on this computer; null sends the Bot to the Box. */
export function pickLocalStarter(
  runtimes: readonly RuntimeInstance[],
  deviceId: string,
): StarterRuntime | null {
  for (const provider of STARTER_LOCAL_PROVIDERS) {
    const match = runtimes.find((instance) => usableRuntime(instance, deviceId, provider))

    if (match) return { runtimeId: match.id, agentRuntime: provider }
  }

  return null
}

/** Rejects once `ms` pass; the call itself goes on, so retrying must be safe. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out')), ms)
  })

  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}
