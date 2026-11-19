// What the fixture agent asks the person with request_user_decision.
import { toolsServer } from './fixture-mcp.mjs'

/**
 * Asks which marker to use: a choice, a credential choice (E2E_ASK_CREDENTIAL), or a secret only
 * the person can type, in its masked card (E2E_ASK_SECRET). */ export function askSteps({
  call,
  log,
  refused,
}) {
  return async (sessionId, text) => {
    // The newest ask decides: a session reopened on another runtime is sent its history too.
    const kind = (text.match(/E2E_ASK\w*/g) ?? []).at(-1)
    const secret = kind === 'E2E_ASK_SECRET'
    const credential = secret || kind === 'E2E_ASK_CREDENTIAL'
    const message = await call(sessionId, 'request_user_decision', {
      label: 'Ask which marker to use',
      category: credential ? 'credential' : 'preference',
      question: secret
        ? 'Which API key should the fixture use?'
        : 'Which marker should the fixture use?',
      // A link the app can open without leaving this computer.
      body: `Background is at ${new URL(toolsServer(sessionId).url).origin}/health/ready`,
      ...(secret
        ? { secretName: 'E2E_API_KEY' }
        : { options: ['E2E_DELIVERY:answered', 'E2E_DELIVERY:other'] }),
    })

    log({ sessionId, event: 'asked', isError: refused(message) })
  }
}
