import { createContext } from 'react'

/** A composer `/` command. `run` gets the composer's editor, for commands that act on it. */
export type SlashCommand = {
  id: string
  title: string
  description: string
  run: (editor: HTMLElement) => void
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
