import { createContext } from 'react'

/** A Nuphos action the composer's `/` menu offers. It runs only when picked. */
export type SlashCommand = {
  id: string
  title: string
  description: string
  run: () => void
}

export const SlashCommandsContext = createContext<SlashCommand[]>([])

/** The `/query` being typed, when the message so far is only that; else null. */
export function slashQuery(textBeforeCaret: string, editorText: string): string | null {
  const match = /^\/(\S{0,20})$/.exec(textBeforeCaret)

  return match && editorText.trimEnd() === textBeforeCaret ? match[1] : null
}

export function matchSlashCommands(commands: readonly SlashCommand[], query: string) {
  const needle = query.toLowerCase()

  return commands.filter(
    (command) => command.id.startsWith(needle) || command.title.toLowerCase().includes(needle),
  )
}

/**
 * What a key does while the menu is open. Typed text such as `/model` is meant
 * for the agent, so Enter runs a command only after the arrows highlighted
 * one (`active` is -1 until then); otherwise it sends the message as typed.
 */
export function slashKeyAction(key: string, shiftKey: boolean, active: number) {
  if (key === 'ArrowDown') return 'next'
  if (key === 'ArrowUp') return 'previous'
  if (key === 'Tab' && !shiftKey) return 'select'
  if (key === 'Enter' && !shiftKey && active >= 0) return 'select'
  if (key === 'Escape') return 'dismiss'

  return null
}
