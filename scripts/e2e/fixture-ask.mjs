// What the fixture agent asks the person with request_user_decision.
import { toolsServer } from './fixture-mcp.mjs'

/**
 * Asks which marker to use: a choice, a credential choice (E2E_ASK_CREDENTIAL), or a secret only
 * the person can type, in its masked card (E2E_ASK_SECRET). E2E_ASK_PERSONAL:<id> asks for the
 * member's own credential instead, which only selecting it answers. */ export function askSteps({
  call,
  log,
  refused,
}) {
  return async (sessionId, text) => {
    // The newest ask decides: a session reopened on another runtime is sent its history too.
    const kind = (text.match(/E2E_ASK\w*/g) ?? []).at(-1)

    if (kind === 'E2E_ASK_PERSONAL') return askPersonal({ call, log, refused }, sessionId, text)
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

async function askPersonal({ call, log, refused }, sessionId, text) {
  const id = /E2E_ASK_PERSONAL:([a-z-]+)/.exec(text)?.[1]
  const message = await call(sessionId, 'request_user_decision', {
    label: 'Ask for a Personal Credential',
    category: 'integration',
    question: `Connect your ${id} so the fixture can read support@ mail`,
    credentials: [{ provider: 'personal', id }],
  })

  log({ sessionId, event: 'asked-personal', detail: id, isError: refused(message) })
}

const SELECTED =
  /now selected for this conversation \(([^)]+)\), so your question is answered \(requestId ([^)]+)\)/

/** Logs the turn Nuphos starts once a question's credentials are selected: what, and which question. */
export function credentialsSelected(log, sessionId, text) {
  const said = SELECTED.exec(text)

  if (said) log({ sessionId, event: 'credentials-selected', detail: `${said[1]} ${said[2]}` })

  return Boolean(said)
}
