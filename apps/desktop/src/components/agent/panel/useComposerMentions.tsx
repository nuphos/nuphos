import { useRef, useState } from 'react'

import { api } from '../../../api'
import { AppAlertDialog } from '../../ui/alert-dialog'

import { matchDevices, matchMembers, mentionQuery } from './composerMention'
import { MENTION_ATTR, optionChip } from './composerMentionChips'
import { MentionPicker } from './composerMentionOptions'
import { announceTimelineChange } from './timelineEvents'
import { useComposerSlashCommands } from './useComposerSlashCommands'

import type { MentionOption } from './composerMentionChips'
import type { CredentialSelectorControl } from './credentialSections'
import type { AgentConversation } from '../../../api/agent-types'
import type { TeamMember } from '../../../types'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

/** The text node the caret sits in and the text before it, when inside `el`. */
function caretText(el: HTMLElement): { node: Text; offset: number } | null {
  const sel = window.getSelection()
  const node = sel?.anchorNode

  if (!sel?.isCollapsed || node?.nodeType !== Node.TEXT_NODE || !el.contains(node)) return null

  return { node: node as Text, offset: sel.anchorOffset }
}

function mentionedUserIds(el: HTMLElement | null): string[] {
  const chips = el?.querySelectorAll<HTMLElement>(`[${MENTION_ATTR}]`) ?? []

  return Array.from(new Set(Array.from(chips, (chip) => chip.dataset.mentionUserId ?? '')))
}

/**
 * `@` mentions in the composer: an autocomplete while typing over teammates
 * and the viewer's own other sessions. A teammate becomes a chip that sends as
 * `@Name` and — like Slack — an offer to invite anyone mentioned who is not in
 * the session yet, asked after the message is sent so the message itself never
 * waits on it. A session becomes the same link chip a pasted session URL does,
 * so the agent receives its canonical link and can read it. A device sends as
 * `@Label` and is turned on for the session, so the agent may run on it.
 */
export function useComposerMentions(
  editorRef: RefObject<HTMLDivElement | null>,
  onEdited: () => void,
  scope?: { teamId: string; sessionId?: string },
  credentials?: Pick<CredentialSelectorControl, 'options' | 'value' | 'onChange'>,
) {
  const slash = useComposerSlashCommands(editorRef, onEdited)
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [anchor, setAnchor] = useState<{
    getBoundingClientRect: () => DOMRect
    contextElement: HTMLElement
  } | null>(null)
  const [uninvited, setUninvited] = useState<TeamMember[]>([])
  // Tagged with the query they answer, so a list for an earlier keystroke is
  // never shown (or picked) under a later one.
  const [sessions, setSessions] = useState<{ query: string; list: AgentConversation[] }>()
  // The query last asked about. A slow answer for an earlier keystroke can
  // land after the latest one's and would otherwise replace it.
  const asked = useRef<string | null>(null)
  const matches: MentionOption[] =
    query === null
      ? []
      : [
          ...(members ? matchMembers(members, query) : []).map((member): MentionOption => ({
            kind: 'member',
            member,
          })),
          ...matchDevices(credentials?.options.devices ?? [], query).map(
            (device): MentionOption => ({ kind: 'device', device }),
          ),
          ...(sessions?.query === query ? sessions.list : []).map((session): MentionOption => ({
            kind: 'session',
            session,
          })),
        ]

  function loadMembers() {
    if (members || !scope) return
    setMembers([])
    api
      .atlasListTeamMembers(scope.teamId)
      .then(setMembers)
      .catch(() => setMembers(null))
  }

  /** The viewer's own sessions matching the query, newest activity first. */
  function loadSessions(next: string) {
    if (!scope) return
    asked.current = next
    api
      .agentListConversations(scope.teamId, { scope: 'mine', search: next || undefined, limit: 6 })
      .then((page) => {
        if (asked.current !== next) return
        setSessions({
          query: next,
          list: page.conversations
            .filter((session) => session.sessionId !== scope.sessionId)
            .slice(0, 5),
        })
      })
      .catch(() => setSessions(undefined))
  }

  function onInput() {
    slash.onInput()
    const el = editorRef.current
    const caret = el && caretText(el)
    const next = caret && scope ? mentionQuery(caret.node.data.slice(0, caret.offset)) : null

    setQuery(next)
    setActive(0)
    if (next === null || !el || !caret) return
    const range = document.createRange()

    range.setStart(caret.node, caret.offset)
    range.collapse(true)
    setAnchor({ getBoundingClientRect: () => range.getBoundingClientRect(), contextElement: el })
    loadMembers()
    loadSessions(next)
  }

  function select(option: MentionOption) {
    const el = editorRef.current
    const caret = el && caretText(el)

    if (!caret || query === null || !scope) return
    const range = document.createRange()

    range.setStart(caret.node, caret.offset - query.length - 1)
    range.setEnd(caret.node, caret.offset)
    range.deleteContents()
    const chip = optionChip(option, scope.teamId)

    if (
      option.kind === 'device' &&
      credentials &&
      !credentials.value.deviceIds.includes(option.device.deviceId)
    ) {
      credentials.onChange({
        ...credentials.value,
        deviceIds: [...credentials.value.deviceIds, option.device.deviceId],
      })
    }

    range.insertNode(chip)
    const trailing = document.createTextNode(' ')

    chip.after(trailing)
    range.setStartAfter(trailing)
    range.collapse(true)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    setQuery(null)
    onEdited()
  }

  /** Handles the picker's keys; true when the key was its to take. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): boolean {
    if (slash.onKeyDown(e)) return true
    // An IME's Enter confirms its candidate, not a member.
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

  async function offerInvites(ids: string[]) {
    if (!scope?.sessionId || ids.length === 0) return
    const { participants } = await api.agentGetConversationParticipants(
      scope.sessionId,
      scope.teamId,
    )
    const joined = new Set(participants.map((participant) => participant.id))

    setUninvited((members ?? []).filter((m) => ids.includes(m.id) && !joined.has(m.id)))
  }

  /** Read the mentions before the composer clears; ask about them once sent. */
  function wrapSend(send: (text: string, filePaths: string[]) => void) {
    return (text: string, filePaths: string[]) => {
      const ids = mentionedUserIds(editorRef.current)

      send(text, filePaths)
      setQuery(null)
      // A brand-new conversation may not exist server-side yet; then there is
      // simply no one to offer.
      offerInvites(ids).catch(() => setUninvited([]))
    }
  }

  const names = uninvited.map((member) => member.name || member.email)
  const ui = (
    <>
      {slash.ui}
      <MentionPicker
        allDevices={credentials?.options.devices ?? []}
        options={matches}
        active={active}
        anchor={anchor}
        onSelect={select}
        onActive={setActive}
        onClose={() => setQuery(null)}
      />
      <AppAlertDialog
        open={uninvited.length > 0}
        title={
          uninvited.length === 1
            ? `Invite ${names[0]} to this session?`
            : `Invite ${String(uninvited.length)} people to this session?`
        }
        description={`You mentioned ${names.join(', ')}, but they are not in this session yet.`}
        confirmLabel="Invite"
        cancelLabel="Don't invite"
        onConfirm={async () => {
          if (!scope?.sessionId) return
          await api.agentInviteConversationParticipants(
            scope.sessionId,
            scope.teamId,
            uninvited.map((member) => member.id),
          )
          announceTimelineChange(scope.sessionId)
        }}
        onClose={() => setUninvited([])}
      />
    </>
  )

  return { onInput, onKeyDown, wrapSend, ui }
}
