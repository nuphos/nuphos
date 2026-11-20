import { claudeNotice } from './openab-acp-errors'

/** The agent's own explanation, bounded for the failure row. */
export function displayAgentNotice(error: unknown): string | undefined {
  const notice = claudeNotice(error)

  if (!notice) return undefined
  const chars = Array.from(notice)

  return chars.length > 200 ? `${chars.slice(0, 199).join('')}…` : notice
}
