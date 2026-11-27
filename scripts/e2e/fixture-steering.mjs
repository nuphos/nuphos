// A fixture agent that takes steers and acknowledges each one late (#5190): it starts so
// while `slow-steer` exists beside the ACP log.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Whether a session opening now takes steers. */
export const takesSteers = () =>
  existsSync(join(dirname(process.env.E2E_ACP_LOG ?? ''), 'slow-steer'))

/** A steering agent says it is working, as Claude Code does, so OpenAB lets steers in. */
export function reportWorking(send, sessionId) {
  if (!takesSteers()) return
  send({
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'session_info_update',
        _meta: { 'ai.nuphos/sessionState': { state: 'active' } },
      },
    },
  })
}

/** Injected, but acknowledged after OpenAB's 10s wait, as a busy agent can. */
export async function steer(log, { sessionId, prompt }) {
  const markers = JSON.stringify(prompt).match(/E2E_DELIVERY:[a-z0-9-]+/g) ?? []

  log({ sessionId, event: 'steered', markers })
  await new Promise((resolve) => setTimeout(resolve, 12_000))

  return { outcome: 'injected' }
}
