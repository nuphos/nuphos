import { createContext } from 'react'

import type { AgentCommand } from '../../../lib/runtimeExecution.ts'

/** A Nuphos action the composer's `/` menu offers. It runs only when picked. */
export type SlashCommand = {
  id: string
  title: string
  description: string
  run: () => void
}

export const SlashCommandsContext = createContext<SlashCommand[]>([])

/** A row in the `/` menu: one of the agent's own commands, or a Nuphos action. */
export type SlashOption =
  { kind: 'agent'; command: AgentCommand } | { kind: 'nuphos'; action: SlashCommand }

/**
 * The `/query` being typed at the caret. `leading` when the message so far is
 * only that, which is where Nuphos actions are offered too; a token later in the
 * message (after a space, caret at its end) offers only the agent's commands.
 * `start` is where the `/` sits in `textBeforeCaret`.
 */
export type SlashToken = { query: string; start: number; leading: boolean }

export function slashToken(
  textBeforeCaret: string,
  textAfterCaret: string,
  editorText: string,
): SlashToken | null {
  const match = /(^|\s)\/([^\s/]{0,64})$/.exec(textBeforeCaret)

  if (!match || /^\S/.test(textAfterCaret)) return null
  const start = match.index + match[1].length

  return {
    query: match[2],
    start,
    leading: start === 0 && editorText.trimEnd() === textBeforeCaret,
  }
}

export function matchSlashCommands(commands: readonly SlashCommand[], query: string) {
  const needle = query.toLowerCase()

  return commands.filter(
    (command) => command.id.startsWith(needle) || command.title.toLowerCase().includes(needle),
  )
}

/**
 * The agent's commands first, the most used ahead (A to Z among equals), then
 * the Nuphos actions (only for a leading `/`).
 */
export function matchSlashOptions(
  agent: readonly AgentCommand[],
  actions: readonly SlashCommand[],
  query: string,
  leading = true,
  usage: Readonly<Record<string, number>> = {},
): SlashOption[] {
  const needle = query.toLowerCase()
  const uses = (command: AgentCommand) => usage[command.name] ?? 0

  return [
    ...agent
      .filter((command) => command.name.toLowerCase().startsWith(needle))
      .sort(
        (a, b) =>
          uses(b) - uses(a) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      )
      .map((command) => ({ kind: 'agent' as const, command })),
    ...(leading ? matchSlashCommands(actions, query) : []).map((action) => ({
      kind: 'nuphos' as const,
      action,
    })),
  ]
}

/** Rows the menu is tall; the rest scroll, by wheel or by the arrows. */
export const SLASH_VISIBLE_ROWS = 5

/**
 * The row plain Enter picks, or null when Enter should send. A row the arrows
 * picked always counts. Otherwise Enter only completes an agent command (the
 * highlighted one, else the first): it just fills in text, so it is safe without
 * the arrows. A Nuphos action runs, so it needs the arrows or its full name
 * (`/fork`). An agent command typed out in full is sent as it is, even when
 * another row is highlighted.
 */
export function slashEnterTarget(
  options: readonly SlashOption[],
  query: string,
  pick: { active: number; armed: boolean },
): SlashOption | null {
  if (pick.armed && pick.active >= 0) return options[pick.active] ?? null
  if (options.length === 0) return null
  const typed = query.toLowerCase()

  // Wherever it sorts: a longer, more used command may be first or under the pointer.
  if (options.some((o) => o.kind === 'agent' && o.command.name.toLowerCase() === typed)) {
    return null
  }
  // A Nuphos action typed out in full runs, as picking it does.
  const action = options.find((o) => o.kind === 'nuphos' && o.action.id === typed)

  if (action) return action
  const candidate = options[pick.active >= 0 ? pick.active : 0]

  return candidate.kind === 'agent' ? candidate : null
}

/** The row the menu shows highlighted: the one picked, else the one Enter completes. */
export function slashShownRow(
  options: readonly SlashOption[],
  active: number,
  enterTarget: SlashOption | null,
): number {
  return active >= 0 || !enterTarget ? active : options.indexOf(enterTarget)
}

/** Where an arrow moves the highlight from `from`; with none, ↓ goes to the first row and ↑ to the last. */
export function slashStep(from: number, step: 1 | -1, total: number): number {
  if (from < 0) return step > 0 ? 0 : total - 1

  return (from + step + total) % total
}

/**
 * What a key does while the menu is open. Enter selects only when
 * `slashEnterTarget` found a row; otherwise the message is sent as typed.
 */
export function slashKeyAction(key: string, shiftKey: boolean, enterSelects: boolean) {
  if (key === 'ArrowDown') return 'next'
  if (key === 'ArrowUp') return 'previous'
  if (key === 'Tab' && !shiftKey) return 'select'
  if (key === 'Enter' && !shiftKey && enterSelects) return 'enter'
  if (key === 'Escape') return 'dismiss'

  return null
}
