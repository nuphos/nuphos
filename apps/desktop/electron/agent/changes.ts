// Which of a team's conversations changed, as the backend pushes it (#3523), passed to every
// window so a chat on screen reads again at once instead of on its next poll.
import { CLIENT_VERSION_HEADER, CLIENT_VERSION_VALUE } from '../client-version'

import { agentAccount } from './http'
import { broadcast } from './notify'
import { abortableSleep } from './stream-errors'

/**
 * `sessionId` null with `connected`: the stream came up (whatever is on screen reads again)
 * or went down (the team's chats poll until it is back).
 */
export type AgentChange = { teamId: string; sessionId: string | null; connected?: boolean }

// The backend's heartbeat is 5 s: three missed is a dead stream.
const SILENT_MS = 15_000
const followed = new Map<string, AbortController>()

/** Follows a team's changes until `unfollowAgentChanges`, reconnecting as long as it takes. */
export function followAgentChanges(teamId: string) {
  if (followed.has(teamId)) return
  const ac = new AbortController()

  followed.set(teamId, ac)
  void follow(teamId, ac.signal)
}

export function unfollowAgentChanges(teamId: string) {
  followed.get(teamId)?.abort()
  followed.delete(teamId)
}

async function follow(teamId: string, signal: AbortSignal) {
  let failures = 0

  while (!signal.aborted) {
    let connected = false
    const outcome = await listen(teamId, signal, () => {
      connected = true
      failures = 0
    }).catch(() => 'failed' as const)

    if (connected)
      broadcast('agent:changes', {
        teamId,
        sessionId: null,
        connected: false,
      } satisfies AgentChange)
    // Version compatibility only: a backend without the push (before #3906, the first backend
    // release after 0.145.4) has no such route; its chats keep polling. Deleted in #3914.
    if (outcome === 'unsupported') {
      followed.delete(teamId)

      return
    }
    failures += 1
    await abortableSleep(Math.min(30_000, 500 * 2 ** failures), signal).catch(() => undefined)
  }
}

async function listen(teamId: string, signal: AbortSignal, opened: () => void) {
  const account = await agentAccount()
  const silent = new AbortController()
  let timer = setTimeout(() => silent.abort(), SILENT_MS)
  const res = await fetch(`${account.api}/teams/${encodeURIComponent(teamId)}/agent-changes`, {
    headers: {
      authorization: `Bearer ${account.token}`,
      accept: 'text/event-stream',
      'accept-encoding': 'identity',
      [CLIENT_VERSION_HEADER]: CLIENT_VERSION_VALUE,
    },
    signal: AbortSignal.any([signal, account.signal, silent.signal]),
  })

  try {
    if (res.status === 404) return 'unsupported'
    if (!res.ok || !res.body) return 'failed'
    opened()
    // Whatever changed while not listening.
    broadcast('agent:changes', { teamId, sessionId: null, connected: true } satisfies AgentChange)
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''

    for (;;) {
      const { done, value } = await reader.read()

      if (done) return 'ended'
      clearTimeout(timer)
      timer = setTimeout(() => silent.abort(), SILENT_MS)
      buffer += value
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const data = buffer
          .slice(0, end)
          .split('\n')
          .find((line) => line.startsWith('data: '))

        buffer = buffer.slice(end + 2)
        if (!data) continue
        const { sessionId } = JSON.parse(data.slice(6)) as { sessionId?: unknown }

        if (typeof sessionId === 'string')
          broadcast('agent:changes', { teamId, sessionId } satisfies AgentChange)
      }
    }
  } finally {
    clearTimeout(timer)
  }
}
