// A teammate's turn out of usage moves the owner's conversation down its fallback list, but
// only to an agent the teammate may use. Driven through the API as the teammate, as a phone does.
import { randomUUID } from 'node:crypto'

import { agentLog } from './agent-log.ts'
import { joinTeam } from './dashboard-scenarios.ts'
import { until } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const LAPTOP = 'e2e-fallback-laptop'

type Runtime = { id: string; label: string; local?: { deviceId: string; shared?: object } }
type Detail = {
  runtimeId: string
  activeRun: unknown
  messages: unknown[]
  timelineEvents: { kind: string; reason?: string; to?: { label: string } }[]
}

const moved = (detail: Detail) => detail.timelineEvents.filter((e) => e.kind === 'runtime_moved')

function rest(stack: Stack, token: string) {
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(stack.apiUrl + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()

    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text}`)

    return (text ? JSON.parse(text) : {}) as T
  }
}

// One conversation read as `reader`; `say` sends one message onto its stored transcript and
// answers with the turn's whole event stream.
function conversation(stack: Stack, reader: string) {
  const sessionId = randomUUID()
  const read = () =>
    rest(stack, reader)<Detail>('GET', `/agent/conversations/${sessionId}?teamId=${stack.teamId}`)
  const settled = async () => {
    let detail: Detail | undefined

    await until('the turn to end', async () => {
      detail = await read()

      return !detail.activeRun
    })

    return detail!
  }
  const say = async (token: string, text: string, start?: object) => {
    const response = await fetch(`${stack.apiUrl}/agent/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: sessionId,
        teamId: stack.teamId,
        messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }],
        streamId: randomUUID(),
        ...(start ?? { baseIndex: (await settled()).messages.length }),
      }),
      signal: AbortSignal.timeout(90_000),
    })

    if (!response.ok) throw new Error(`The send answered ${response.status}`)

    return response.text()
  }

  return { sessionId, read, settled, say }
}

// The owner's computer with a signed-in Claude Code, online until the returned function is called.
async function laptopOnline(stack: Stack): Promise<() => void> {
  await rest(stack, stack.token)('PUT', '/agent/devices', {
    deviceId: LAPTOP,
    label: 'E2E fallback laptop',
    platform: 'darwin',
    allowLocalExec: true,
  })
  const tunnel = new WebSocket(
    `${stack.apiUrl.replace(/^http/, 'ws')}/agent/devices/${LAPTOP}/runtime-tunnel`,
    { headers: { authorization: `Bearer ${stack.token}` } } as unknown as string[],
  )

  tunnel.addEventListener('message', () => tunnel.send(JSON.stringify({ t: 'pong' })))
  await new Promise((opened, failed) => {
    tunnel.addEventListener('open', opened)
    tunnel.addEventListener('error', failed)
  })
  tunnel.send(
    JSON.stringify({
      t: 'status',
      status: { agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } } },
    }),
  )

  return () => tunnel.close()
}

export const fallbackScenarios: Scenario[] = [
  {
    // Fails without the fix: usableBy let a teammate's turn onto `managed` agents only, so
    // E2E second agent (`external`) is passed over and the wait for the move times out. Not a
    // Box: no agent on a computer here runs turns (fixture-claude.mjs only signs in).
    name: "a teammate's turn out of usage falls back to an agent they may use, never the owner's computer",
    // The laptop is forgotten once its tunnel has closed; until then the delete is refused.
    expected: /"error_code":"device_online"/,
    run: async (_page, stack) => {
      const teammate = await joinTeam(stack, 'fallback-teammate')
      const owner = rest(stack, stack.token)
      const as = rest(stack, teammate.token)
      const team = `/teams/${stack.teamId}`
      const runtimes = async (call: typeof owner) =>
        (await call<{ runtimes: Runtime[] }>('GET', `${team}/agent-runtimes`)).runtimes
      const listed = await runtimes(owner)
      const idOf = (label: string) => {
        const id = listed.find((runtime) => runtime.label === label)?.id

        if (!id) throw new Error(`${label} is not listed`)

        return id
      }
      const [first, second] = [idOf('E2E fixture agent'), idOf('E2E second agent')]
      const fallBackTo = (fallbackRuntimeId: string | null) =>
        owner('PUT', `${team}/runtime-fallbacks/${first}`, { fallbackRuntimeId })
      const { sessionId, read, settled, say } = conversation(stack, teammate.token)
      const refused = 'E2E_DELIVERY:teammate-fallback-refused'
      const ran = 'E2E_DELIVERY:teammate-fallback-ran'

      await say(stack.token, 'Start E2E_DELIVERY:teammate-fallback-start', {
        runtimeId: first,
        agentRuntime: 'claude-code',
      })
      await owner('POST', `/agent/conversations/${sessionId}/participants`, {
        teamId: stack.teamId,
        userIds: [teammate.id],
      })
      const goOffline = await laptopOnline(stack)

      try {
        await owner('PUT', `/agent/devices/${LAPTOP}/share?teamId=${stack.teamId}`, {
          level: 'full',
          everyone: false,
          userIds: [teammate.id],
          managerIds: [],
        })
        let laptop: Runtime | undefined

        await until('the teammate to list the laptop as shared with them', async () => {
          laptop = (await runtimes(as)).find((runtime) => runtime.local?.deviceId === LAPTOP)

          return laptop?.local?.shared
        })
        // Only the owner's computer, shared with the teammate, is next: their turn stays put.
        await fallBackTo(laptop!.id)
        const stream = await say(teammate.token, 'Out of usage E2E_USAGE_LIMIT E2E_DELIVERY:kept')

        await until('the fallback to stop', async () =>
          (await read()).timelineEvents.some((e) => e.kind === 'runtime_fallback_stopped'),
        )
        const kept = await settled()

        if (kept.runtimeId !== first || moved(kept).length)
          throw new Error(`The teammate's turn moved to the owner's computer: ${kept.runtimeId}`)
        if (!/hit your usage limit/.test(stream + JSON.stringify(kept.messages)))
          throw new Error('The refused turn did not say it was out of usage')

        // A team agent is next: the conversation moves, and the teammate sends again.
        await fallBackTo(second)
        await say(teammate.token, `Out of usage again E2E_USAGE_LIMIT ${refused}`)
        await until('the conversation to fall back to E2E second agent', async () => {
          const detail = await read()

          return detail.runtimeId === second && moved(detail).length
        })
        const move = moved(await settled())[0]

        if (move?.reason !== 'failure' || move.to?.label !== 'E2E second agent')
          throw new Error(`The move does not say a failed turn moved it: ${JSON.stringify(move)}`)
        await say(teammate.token, `Sent again ${ran}`)
        await until('the teammate’s turn to finish on E2E second agent', async () =>
          agentLog(stack).some(
            (e) => e.agent === 'second' && e.marker === ran && e.event === 'finish',
          ),
        )
        await until('the answer to be in the conversation', async () =>
          JSON.stringify((await settled()).messages).includes(`ACK ${ran}`),
        )
        // A teammate's refused turn is theirs to send again; it never runs again by itself.
        if (agentLog(stack).some((e) => e.agent === 'second' && e.marker === refused))
          throw new Error('The refused turn ran again on E2E second agent by itself')
      } finally {
        goOffline()
        await fallBackTo(null)
        await until('the laptop to be forgotten', async () =>
          owner('DELETE', `/agent/devices/${LAPTOP}`),
        )
      }
    },
  },
  movesDown(
    // #4037. Fails without the fix: a model the endpoint does not serve was not the agent
    // failing, so the conversation stayed on E2E fixture agent and the wait for the move times out.
    'a turn on a model its endpoint does not serve moves down the fallback list and goes on',
    'Retired model E2E_MODEL_NOT_FOUND E2E_DELIVERY:model-not-found',
    /model: claude-e2e-retired/,
  ),
  // A session limit hit after the answer began: Claude Code's adapter used to leave such a turn
  // open until the 30-minute inactivity timeout, so the wait for the move times out without it.
  movesDown(
    'a session limit hit mid-turn ends the turn at once and moves down the fallback list',
    'Mid-turn limit E2E_SESSION_LIMIT E2E_DELIVERY:session-limit',
    /hit your session limit/,
  ),
]

function movesDown(name: string, prompt: string, expected?: RegExp): Scenario {
  return {
    name,
    ...(expected && { expected }),
    run: async (_page, stack) => {
      const owner = rest(stack, stack.token)
      const team = `/teams/${stack.teamId}`
      const { runtimes } = await owner<{ runtimes: Runtime[] }>('GET', `${team}/agent-runtimes`)
      const [first, second] = ['E2E fixture agent', 'E2E second agent'].map(
        (label) => runtimes.find((runtime) => runtime.label === label)!.id,
      )
      const fallBackTo = (fallbackRuntimeId: string | null) =>
        owner('PUT', `${team}/runtime-fallbacks/${first}`, { fallbackRuntimeId })
      const { read, settled, say } = conversation(stack, stack.token)
      const onSecond = () =>
        agentLog(stack).filter((e) => e.agent === 'second' && e.event === 'finish').length
      const before = onSecond()

      await fallBackTo(second)
      try {
        await say(stack.token, prompt, { runtimeId: first, agentRuntime: 'claude-code' })
        await until('the conversation to fall back to E2E second agent', async () => {
          const detail = await read()

          return detail.runtimeId === second && moved(detail).length
        })
        const move = moved(await settled())[0]

        if (move?.reason !== 'failure' || move.to?.label !== 'E2E second agent')
          throw new Error(`The move does not say a failed turn moved it: ${JSON.stringify(move)}`)
        // The owner's interrupted turn goes on by itself on the agent it moved to.
        await until('the turn to go on on E2E second agent', async () => onSecond() > before)
      } finally {
        await fallBackTo(null)
      }
    },
  }
}
