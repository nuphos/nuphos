import { CLIENT_VERSION_HEADER, CLIENT_VERSION_VALUE } from '../client-version.ts'
import { readDeviceIdentity } from '../main/device-identity.ts'

import { agentAccount } from './http.ts'

const waits = new Map<string, AbortController>()

/**
 * Resolves once the turn streaming as `streamId` ends. It attaches read-only past the frames
 * already sent, so it reads nothing but what is still to come, and detaching never stops the
 * turn. It also resolves when nothing runs there, or the backend can't be reached.
 */
export async function waitForRunEnd(args: {
  sessionId: string
  teamId: string
  streamId: string
}): Promise<void> {
  waits.get(args.streamId)?.abort()
  const ac = new AbortController()

  waits.set(args.streamId, ac)
  try {
    const account = await agentAccount()

    account.signal.addEventListener('abort', () => ac.abort(), { once: true, signal: ac.signal })
    const res = await fetch(`${account.api}/agent/chat`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${account.token}`,
        accept: 'text/event-stream',
        [CLIENT_VERSION_HEADER]: CLIENT_VERSION_VALUE,
        'x-nuphos-device-id': readDeviceIdentity().deviceId,
      },
      body: JSON.stringify({
        id: args.sessionId,
        teamId: args.teamId,
        streamId: args.streamId,
        messages: [],
        resume: true,
        resumeFrom: Number.MAX_SAFE_INTEGER,
      }),
    })

    // The backend closes this stream when the turn ends.
    await res.body?.pipeTo(new WritableStream())
  } catch {
    // Stopped, signed out or unreachable: the caller lists again either way.
  } finally {
    if (waits.get(args.streamId) === ac) waits.delete(args.streamId)
  }
}

export function stopWaitingForRunEnd(streamId: string): void {
  waits.get(streamId)?.abort()
}
