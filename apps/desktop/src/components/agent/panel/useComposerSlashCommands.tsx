import { useContext, useState } from 'react'

import {
  agentCommandText,
  matchSlashOptions,
  slashKeyAction,
  slashQuery,
  SlashCommandsContext,
} from './composerSlashCommands'
import { SlashCommandPicker } from './SlashCommandPicker'

import type { SlashCommand, SlashOption } from './composerSlashCommands'
import type { AgentCommand } from '../../../lib/runtimeExecution'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

/**
 * Typing `/` at the start of a message lists the agent's own commands, then the
 * Nuphos actions the panel provides (plus Model when this composer has a model
 * control). An agent command is only written into the message; a Nuphos action
 * runs only when picked. Escape keeps the menu closed until the leading `/` is gone.
 */
export function useComposerSlashCommands(
  editorRef: RefObject<HTMLDivElement | null>,
  composingRef: RefObject<boolean>,
  onEdited: () => void,
  openModel?: () => void,
  agentCommands: readonly AgentCommand[] = [],
) {
  const panelCommands = useContext(SlashCommandsContext)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(-1)
  // Only the arrows arm Enter; a pointer resting over the menu does not.
  const [armed, setArmed] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [anchor, setAnchor] = useState<{
    getBoundingClientRect: () => DOMRect
    contextElement: HTMLElement
  } | null>(null)
  const commands: SlashCommand[] = openModel
    ? [
        ...panelCommands,
        { id: 'model', title: 'Model', description: 'Change the model', run: openModel },
      ]
    : panelCommands
  const matches =
    query === null || dismissed ? [] : matchSlashOptions(agentCommands, commands, query)

  function onInput() {
    const el = editorRef.current
    const sel = window.getSelection()
    const node = sel?.anchorNode

    // An IME draft such as `/mo` before conversion is not a query yet.
    if (composingRef.current) return
    const typed = el?.textContent ?? ''

    // A new message starts fresh: sending clears the editor without an input event.
    if (!typed.startsWith('/') || typed === '/') setDismissed(false)
    if (!el || !sel?.isCollapsed || node?.nodeType !== Node.TEXT_NODE || !el.contains(node)) {
      setQuery(null)

      return
    }
    const text = node as Text
    const next = slashQuery(text.data.slice(0, sel.anchorOffset), el.textContent)

    setQuery(next)
    setActive(-1)
    setArmed(false)
    if (next === null) return
    const range = document.createRange()

    range.setStart(text, 0)
    range.collapse(true)
    setAnchor({ getBoundingClientRect: () => range.getBoundingClientRect(), contextElement: el })
  }

  function select(option: SlashOption) {
    const el = editorRef.current

    setQuery(null)
    if (!el) return
    if (option.kind === 'nuphos') {
      el.textContent = ''
      onEdited()
      option.action.run()

      return
    }
    const { text, hintStart } = agentCommandText(option.command)

    el.textContent = text
    const sel = window.getSelection()

    if (el.firstChild && sel) {
      const range = document.createRange()

      range.setStart(el.firstChild, hintStart)
      range.setEnd(el.firstChild, text.length)
      sel.removeAllRanges()
      sel.addRange(range)
    }
    onEdited()
  }

  /** Handles the menu's keys; true when the key was its to take. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): boolean {
    if (matches.length === 0 || e.nativeEvent.isComposing) return false
    const action = slashKeyAction(e.key, e.shiftKey, { active, armed })

    if (action === 'next' || action === 'previous') {
      const step = action === 'next' ? 1 : -1

      setArmed(true)

      setActive((index) =>
        index < 0 && step < 0
          ? matches.length - 1
          : (index + step + matches.length) % matches.length,
      )
    } else if (action === 'select') {
      select(matches[active] ?? matches[0])
    } else if (action === 'dismiss') {
      setDismissed(true)
    } else {
      // Plain Enter sends the text as typed; the menu goes with it.
      if (e.key === 'Enter') setQuery(null)

      return false
    }
    e.preventDefault()

    return true
  }

  const ui = (
    <SlashCommandPicker
      options={matches}
      active={active}
      anchor={anchor}
      onSelect={select}
      onActive={(index) => {
        setActive(index)
        setArmed(false)
      }}
      onClose={() => setDismissed(true)}
    />
  )

  return { onInput, onKeyDown, ui }
}
