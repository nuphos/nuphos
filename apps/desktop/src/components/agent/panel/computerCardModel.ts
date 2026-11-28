import { COMPUTER_OPTIONS } from '../../../api/agent-input-request.ts'

import type { ComputerDesktop } from '../../../api/agent-input-request.ts'

export type ComputerRequest = { question: string; body?: string; desktop: ComputerDesktop }

function isDesktop(value: unknown): value is ComputerDesktop {
  const desktop = value as Partial<ComputerDesktop> | null

  return (
    typeof desktop?.deviceId === 'string' &&
    typeof desktop.display === 'number' &&
    typeof desktop.title === 'string'
  )
}

/** The desktop a tool result names, as an object, its JSON, or an MCP result's text parts. */
function desktopIn(output: unknown, depth = 0): ComputerDesktop | undefined {
  if (depth > 3 || !output) return undefined
  if (typeof output === 'string') {
    try {
      return desktopIn(JSON.parse(output), depth + 1)
    } catch {
      return undefined
    }
  }
  if (Array.isArray(output))
    return output
      .map((item) => desktopIn((item as { text?: unknown }).text, depth + 1))
      .find(Boolean)
  const { desktop, content } = output as { desktop?: unknown; content?: unknown }

  return isDesktop(desktop) ? desktop : desktopIn(content, depth + 1)
}

/**
 * A `computer` card: the question asked, and the desktop its result hands over.
 * Until the result names a desktop there is nothing to show, so it is not one yet.
 */
export function parseComputerRequest(input: unknown, output: unknown): ComputerRequest | null {
  const { category, question, body } = (input ?? {}) as {
    category?: unknown
    question?: unknown
    body?: unknown
  }
  const desktop = category === 'computer' ? desktopIn(output) : undefined

  if (!desktop || typeof question !== 'string') return null

  return { question, ...(typeof body === 'string' && body ? { body } : {}), desktop }
}

const HANDED_BACK = new RegExp(`^${COMPUTER_OPTIONS[0]} \\(handed back after ([^)]+)\\)$`)

/**
 * How a `computer` card ended, from the answer the server recorded: handed back
 * after a takeover (and for how long), done without one, or skipped.
 */
export function computerOutcome(
  option: string | undefined,
): { kind: 'handed-back'; after: string } | { kind: 'done' | 'skipped' } | undefined {
  if (option === undefined) return undefined
  const after = HANDED_BACK.exec(option)?.[1]

  if (after) return { kind: 'handed-back', after }

  return option === COMPUTER_OPTIONS[1] ? { kind: 'skipped' } : { kind: 'done' }
}
