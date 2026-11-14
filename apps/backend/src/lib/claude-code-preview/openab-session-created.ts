import { parseSessionConfigOptions } from './session-config-options'

import type { SessionConfigOption } from './session-config-options'

/**
 * What `session/new` reported: its id, and the settings it started with. A
 * runtime that names no config options yields none, never an empty list.
 */
export type CreatedSession = {
  sessionId: string
  sessionConfig?: SessionConfigOption[]
}

export function createdSession(result: Record<string, unknown>): CreatedSession {
  const { sessionId } = result

  if (typeof sessionId !== 'string' || sessionId.length === 0)
    throw new Error('OpenAB returned an invalid ACP session id')
  const sessionConfig = Array.isArray(result.configOptions)
    ? parseSessionConfigOptions(result.configOptions)
    : undefined

  return { sessionId, ...(sessionConfig?.length ? { sessionConfig } : {}) }
}
