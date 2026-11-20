/**
 * The id `session/new` named. Through OpenAB it carries no settings: the agent's
 * own session opens on the first prompt, and its settings come up then as a
 * `config_option_update` (#3789).
 */
export type CreatedSession = { sessionId: string }

export function createdSession(result: Record<string, unknown>): CreatedSession {
  const { sessionId } = result

  if (typeof sessionId !== 'string' || sessionId.length === 0)
    throw new Error('OpenAB returned an invalid ACP session id')

  return { sessionId }
}
