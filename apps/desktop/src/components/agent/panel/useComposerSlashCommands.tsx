import { useContext, useState } from 'react'

import { matchSlashCommands, slashQuery, SlashCommandsContext } from './composerSlashCommands'
import { SlashCommandPicker } from './SlashCommandPicker'

import type { SlashCommand } from './composerSlashCommands'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

/** Typing `/` at the start of a message opens the commands the surrounding panel provides. */
export function useComposerSlashCommands(
  editorRef: RefObject<HTMLDivElement | null>,
  onEdited: () => void,
) {
  const commands = useContext(SlashCommandsContext)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [anchor, setAnchor] = useState<{
    getBoundingClientRect: () => DOMRect
    contextElement: HTMLElement
  } | null>(null)
  const matches = query === null ? [] : matchSlashCommands(commands, query)

  function onInput() {
    const el = editorRef.current
    const sel = window.getSelection()
    const node = sel?.anchorNode

    if (!el || !sel?.isCollapsed || node?.nodeType !== Node.TEXT_NODE || !el.contains(node)) {
      setQuery(null)

      return
    }
    const text = node as Text
    const next = slashQuery(text.data.slice(0, sel.anchorOffset), el.textContent)

    setQuery(next)
    setActive(0)
    if (next === null) return
    const range = document.createRange()

    range.setStart(text, 0)
    range.collapse(true)
    setAnchor({ getBoundingClientRect: () => range.getBoundingClientRect(), contextElement: el })
  }

  function select(command: SlashCommand) {
    const el = editorRef.current

    setQuery(null)
    if (!el) return
    el.textContent = ''
    onEdited()
    command.run(el)
  }

  /** Handles the menu's keys; true when the key was its to take. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): boolean {
    if (matches.length === 0 || e.nativeEvent.isComposing) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const step = e.key === 'ArrowDown' ? 1 : -1

      setActive((index) => (index + step + matches.length) % matches.length)
    } else if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
      select(matches[active] ?? matches[0])
    } else if (e.key === 'Escape') {
      setQuery(null)
    } else return false
    e.preventDefault()

    return true
  }

  const ui = (
    <SlashCommandPicker
      commands={matches}
      active={active}
      anchor={anchor}
      onSelect={select}
      onActive={setActive}
      onClose={() => setQuery(null)}
    />
  )

  return { onInput, onKeyDown, ui }
}
