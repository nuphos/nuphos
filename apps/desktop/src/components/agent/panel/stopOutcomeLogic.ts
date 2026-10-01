import type { WindowAgentApi } from '../../../api/window-agent'

export type StopRequestStatus = Awaited<ReturnType<WindowAgentApi['agentAbort']>>['status']

export type StopOutcome =
  | { kind: 'stopped'; status: StopRequestStatus }
  | { kind: 'still_running'; status: 'local' | 'forwarded' | 'not_found' }
  | { kind: 'failed'; status: 'unauthenticated' | 'failed' }

// Forwarded cancellation is consumed by the owning replica's 5-second
// heartbeat. The final probe also gives an ownerless busy guard enough time to
// reach the backend's abandoned-guard grace and self-heal.
export const STOP_CONFIRM_RETRY_DELAYS_MS = [1_000, 5_000, 15_000] as const

export async function settleStopOutcome(
  args: {
    sessionId: string
    streamId: string
    teamId?: string
  },
  deps: {
    abort: (streamId: string) => Promise<{ status: StopRequestStatus }>
    getActiveStreamId: (sessionId: string, teamId?: string) => Promise<string | null>
    wait: (delayMs: number) => Promise<void>
  },
): Promise<StopOutcome> {
  const result = await deps.abort(args.streamId)

  if (result.status === 'unauthenticated' || result.status === 'failed') {
    return { kind: 'failed', status: result.status }
  }

  // A local acceptance only means that Nuphos delivered the cancellation to
  // the runtime-owning request. Forwarding and a 404 can likewise race normal
  // teardown. In every accepted case, confirm the runtime-backed active run
  // disappeared instead of treating the transport acknowledgement as truth.
  try {
    for (const delayMs of STOP_CONFIRM_RETRY_DELAYS_MS) {
      await deps.wait(delayMs)
      const activeStreamId = await deps.getActiveStreamId(args.sessionId, args.teamId)

      if (activeStreamId !== args.streamId) {
        return { kind: 'stopped', status: result.status }
      }
    }
  } catch {
    // The abort was accepted or the run was already absent. A failed metadata
    // probe cannot turn that into a user-facing stop failure; the normal send
    // path will still report a real busy guard if one remains.
    return { kind: 'stopped', status: result.status }
  }

  return { kind: 'still_running', status: result.status }
}
