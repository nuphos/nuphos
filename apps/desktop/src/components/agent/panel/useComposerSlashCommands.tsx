import { useContext, useEffect, useRef, useState } from 'react'

import { t } from '../../../i18n'

import {
  matchSlashOptions,
  slashEnterTarget,
  slashKeyAction,
  slashShownRow,
  slashStep,
  slashToken,
  SlashCommandsContext,
} from './composerSlashCommands'
import { SlashCommandPicker } from './SlashCommandPicker'
import {
  readAgentCommands,
  readSlashUsage,
  recordSlashUse,
  rememberAgentCommands,
  slashCommandsIn,
} from './slashUsage'

import type { SlashCommand, SlashOption, SlashToken } from './composerSlashCommands'
import type { AgentCommand } from '../../../lib/runtimeExecution'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

/**
 * Typing `/` lists the agent's own commands, the ones this computer sends most
 * first (then A to Z), in a strip along the top of the composer; at the start of
 * a message the Nuphos actions the panel provides follow (plus Model when this
 * composer has a model control). Before a session lists its commands (a new
 * conversation has none yet), the ones its agent listed last stand in. An
 * agent command is only written into the message, in place of the typed
 * `/query`, and Enter completes the first match. A Nuphos action runs only when
 * picked. Escape keeps the menu closed until the `/` is gone. Sends go through
 * `wrapSend` so the commands in them count as used.
 */
export function useComposerSlashCommands(
  editorRef: RefObject<HTMLDivElement | null>,
  composingRef: RefObject<boolean>,
  onEdited: () => void,
  openModel?: () => void,
  agent: { commands?: readonly AgentCommand[]; runtimeId?: string } = {},
) {
  const { commands: listedCommands, runtimeId } = agent
  const panelCommands = useContext(SlashCommandsContext)
  const [remembered, setRemembered] = useState(() => readAgentCommands(runtimeId))
  const agentCommands = listedCommands ?? remembered
  const [token, setToken] = useState<SlashToken | null>(null)
  // The text node and caret offset the token was read from, for the replacement.
  const where = useRef<{ node: Text; end: number } | null>(null)
  const [active, setActive] = useState(-1)
  // Only the arrows arm Enter for any row; a pointer resting over the menu does not.
  const [armed, setArmed] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [usage, setUsage] = useState(readSlashUsage)
  const [anchor, setAnchor] = useState<{
    getBoundingClientRect: () => DOMRect
    contextElement: HTMLElement
  } | null>(null)
  const commands: SlashCommand[] = openModel
    ? [
        ...panelCommands,
        { id: 'model', title: t('Model'), description: t('Change the model'), run: openModel },
      ]
    : panelCommands
  const matches =
    token === null || dismissed
      ? []
      : matchSlashOptions(agentCommands, commands, token.query, token.leading, usage)
  const enterTarget = token ? slashEnterTarget(matches, token.query, { active, armed }) : null
  // With nothing picked yet, the row Enter would complete shows highlighted; the arrows start there.
  const shown = slashShownRow(matches, active, enterTarget)

  useEffect(() => {
    if (runtimeId && listedCommands) rememberAgentCommands(runtimeId, listedCommands)
  }, [runtimeId, listedCommands])

  function close() {
    setToken(null)
    where.current = null
  }

  function onInput() {
    const el = editorRef.current
    const sel = window.getSelection()
    const node = sel?.anchorNode

    // An IME draft such as `/mo` before conversion is not a query yet.
    if (composingRef.current) return
    if (!el || !sel?.isCollapsed || node?.nodeType !== Node.TEXT_NODE || !el.contains(node)) {
      setDismissed(false)
      close()

      return
    }
    const text = node as Text
    const next = slashToken(
      text.data.slice(0, sel.anchorOffset),
      text.data.slice(sel.anchorOffset),
      el.textContent,
    )

    // A new `/` starts fresh: sending clears the editor without an input event.
    if (next === null || next.query === '') setDismissed(false)
    setToken(next)
    setActive(-1)
    setArmed(false)
    if (next === null) {
      where.current = null

      return
    }
    // The agent may have listed its commands, or been switched, since this composer opened.
    if (token === null && !listedCommands) setRemembered(readAgentCommands(runtimeId))
    where.current = { node: text, end: sel.anchorOffset }
    // The strip sits on the composer itself, as wide as it, not at the caret.
    const card = el.closest<HTMLElement>('.composer-surface') ?? el

    setAnchor({ getBoundingClientRect: () => card.getBoundingClientRect(), contextElement: card })
  }

  function select(option: SlashOption) {
    const el = editorRef.current
    const at = where.current
    const typed = token

    close()
    if (!el) return
    if (option.kind === 'nuphos') {
      el.textContent = ''
      onEdited()
      option.action.run()

      return
    }
    if (!at || !typed || !el.contains(at.node)) return
    // Only the text: the agent runs the command once the message is sent.
    const spaced = /^\s/.test(at.node.data.slice(at.end))
    const text = `/${option.command.name}${spaced ? '' : ' '}`

    at.node.replaceData(typed.start, at.end - typed.start, text)
    const sel = window.getSelection()
    const range = document.createRange()

    el.focus()
    range.setStart(at.node, Math.min(typed.start + text.length + (spaced ? 1 : 0), at.node.length))
    range.collapse(true)
    sel?.removeAllRanges()
    sel?.addRange(range)
    onEdited()
  }

  /** Handles the menu's keys; true when the key was its to take. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): boolean {
    if (matches.length === 0 || e.nativeEvent.isComposing) return false
    const action = slashKeyAction(e.key, e.shiftKey, enterTarget !== null)

    if (action === 'next' || action === 'previous') {
      setArmed(true)
      setActive(slashStep(shown, action === 'next' ? 1 : -1, matches.length))
    } else if (action === 'select') {
      select(matches[shown] ?? matches[0])
    } else if (action === 'enter' && enterTarget) {
      select(enterTarget)
    } else if (action === 'dismiss') {
      setDismissed(true)
    } else {
      // Plain Enter sends the text as typed; the menu goes with it.
      if (e.key === 'Enter') close()

      return false
    }
    e.preventDefault()

    return true
  }

  const ui = (
    <SlashCommandPicker
      options={matches}
      active={shown}
      follow={armed}
      anchor={anchor}
      onSelect={select}
      onActive={(index) => {
        setActive(index)
        setArmed(false)
      }}
      onClose={() => setDismissed(true)}
    />
  )

  /** Wraps a send so the agent commands in each sent message count as used. */
  function wrapSend(send: (text: string, filePaths: string[]) => void) {
    return (text: string, filePaths: string[]) => {
      const used = slashCommandsIn(text, new Set(agentCommands.map((command) => command.name)))

      if (used.length > 0) setUsage(recordSlashUse(used))
      send(text, filePaths)
    }
  }

  return { onInput, onKeyDown, wrapSend, ui }
}
