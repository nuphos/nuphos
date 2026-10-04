// Forward into the existing native turn. Never cancel, start, or replay a turn.
export async function nuphosSteerCodex(agent, params) {
  if (
    typeof params?.sessionId !== 'string' ||
    !Array.isArray(params.prompt) ||
    params.prompt.length === 0 ||
    params.prompt.some(
      (part) => part.type !== 'text' || typeof part.text !== 'string' || !part.text.trim(),
    )
  )
    throw new Error('Steering requires a session and non-empty text')
  const session = agent.getSessionState(params.sessionId)
  const expectedTurnId = session.currentTurnId
  if (!expectedTurnId) return { outcome: 'promptRequired', reason: 'noRunningTurn' }
  const result = await agent.codexAcpClient.codexClient.sendRequest({
    method: 'turn/steer',
    params: {
      threadId: params.sessionId,
      expectedTurnId,
      input: params.prompt.map(({ text }) => ({ type: 'text', text, text_elements: [] })),
    },
  })
  if (result?.turnId !== expectedTurnId) throw new Error('Invalid native steering acknowledgement')
  return { outcome: 'injected' }
}
