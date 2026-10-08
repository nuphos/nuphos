// Forward into the existing native turn. Never cancel, start, or replay a turn.
// `toInput` is the adapter's own prompt conversion, so steered attachments read
// exactly like the ones in a normal prompt.
export async function nuphosSteerCodex(agent, params, toInput) {
  if (
    typeof params?.sessionId !== 'string' ||
    !Array.isArray(params.prompt) ||
    params.prompt.length === 0
  )
    throw new Error('Steering requires a session and a non-empty prompt')
  const session = agent.getSessionState(params.sessionId)
  const expectedTurnId = session.currentTurnId
  if (!expectedTurnId) return { outcome: 'promptRequired', reason: 'noRunningTurn' }
  const result = await agent.codexAcpClient.codexClient.sendRequest({
    method: 'turn/steer',
    params: {
      threadId: params.sessionId,
      expectedTurnId,
      input: toInput(params.prompt),
    },
  })
  if (result?.turnId !== expectedTurnId) throw new Error('Invalid native steering acknowledgement')
  return { outcome: 'injected' }
}
