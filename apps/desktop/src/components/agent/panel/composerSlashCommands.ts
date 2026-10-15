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

/** The `/query` being typed, when the message so far is only that; else null. */
export function slashQuery(textBeforeCaret: string, editorText: string): string | null {
  const match = /^\/(\S{0,64})$/.exec(textBeforeCaret)

  return match && editorText.trimEnd() === textBeforeCaret ? match[1] : null
}

export function matchSlashCommands(commands: readonly SlashCommand[], query: string) {
  const needle = query.toLowerCase()

  return commands.filter(
    (command) => command.id.startsWith(needle) || command.title.toLowerCase().includes(needle),
  )
}

/** The agent's commands first, by name, then the Nuphos actions. */
export function matchSlashOptions(
  agent: readonly AgentCommand[],
  actions: readonly SlashCommand[],
  query: string,
): SlashOption[] {
  const needle = query.toLowerCase()

  return [
    ...agent
      .filter((command) => command.name.toLowerCase().startsWith(needle))
      .map((command) => ({ kind: 'agent' as const, command })),
    ...matchSlashCommands(actions, query).map((action) => ({ kind: 'nuphos' as const, action })),
  ]
}

/**
 * What picking an agent command puts in the message: `/name `, then its hint
 * (selected, so typing replaces it). The agent runs it once the message is sent.
 */
export function agentCommandText(command: AgentCommand): { text: string; hintStart: number } {
  const prefix = `/${command.name} `

  return { text: prefix + (command.hint ?? ''), hintStart: prefix.length }
}

/**
 * What a key does while the menu is open. Typed text such as `/model` is meant
 * for the agent, so Enter runs a command only after the arrows picked one; a
 * row highlighted by the pointer does not count.
 */
export function slashKeyAction(
  key: string,
  shiftKey: boolean,
  pick: { active: number; armed: boolean },
) {
  if (key === 'ArrowDown') return 'next'
  if (key === 'ArrowUp') return 'previous'
  if (key === 'Tab' && !shiftKey) return 'select'
  if (key === 'Enter' && !shiftKey && pick.armed && pick.active >= 0) return 'select'
  if (key === 'Escape') return 'dismiss'

  return null
}
