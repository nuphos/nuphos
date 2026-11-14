import { useRef, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { agentAvatarPick } from '../../../lib/agentAvatarChoices'
import { AppAlertDialog } from '../../ui/alert-dialog'
import { needsComputerUse } from '../computerUse'
import { ComputerUseConfirm } from '../ComputerUseConfirm'

import { matchDevices, matchMembers, mentionQuery } from './composerMention'
import { mentionedMembers, optionChip } from './composerMentionChips'
import { MentionPicker } from './composerMentionOptions'
import { announceTimelineChange } from './timelineEvents'

import type { ComputerUseRequest } from '../computerUse'
import type { ComposerSend, MentionOption } from './composerMentionChips'
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
  scope?: {
    teamId: string
    sessionId?: string
    channel?: boolean
    /** A channel's own people and agents: only they are offered, and not the sender. */
    only?: { agentIds: string[]; selfId: string }
  },
  credentials?: Pick<CredentialSelectorControl, 'options' | 'value' | 'onChange'>,
) {
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [anchor, setAnchor] = useState<{
    getBoundingClientRect: () => DOMRect
    contextElement: HTMLElement
  } | null>(null)
  const [uninvited, setUninvited] = useState<TeamMember[]>([])
  const [computerUse, setComputerUse] = useState<ComputerUseRequest | null>(null)
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
    const { only, sessionId, teamId } = scope

    Promise.all([
      api.atlasListTeamMembers(teamId),
      only && sessionId ? api.agentGetConversationParticipants(sessionId, teamId) : undefined,
    ])
      .then(([team, access]) => {
        const here = access && new Set(access.participants.map((person) => person.id))

        setMembers(here ? team.filter((m) => here.has(m.id) && m.id !== only?.selfId) : team)
      })
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
            .filter((session) => !scope.only || scope.only.agentIds.includes(session.sessionId))
            .slice(0, 5),
        })
      })
      .catch(() => setSessions(undefined))
  }

  function onInput() {
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
    const chip = optionChip(option, scope.teamId, scope.channel)

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
  function wrapSend(send: ComposerSend): ComposerSend {
    return (text, filePaths, _mentions, options) => {
      const mentions = mentionedMembers(editorRef.current)
      const ids = mentions.map((mention) => mention.id)
      const accepted = send(text, filePaths, mentions, options)

      setQuery(null)
      // Only a message that went out addresses anyone; a refused send leaves
      // the chips in the composer and nobody uninvited.
      if (accepted) offerInvites(ids).catch(() => setUninvited([]))

      return accepted
    }
  }

  const bot = Boolean(scope?.sessionId && agentAvatarPick(scope.sessionId))

  const names = uninvited.map((member) => member.name || member.email)
  const ui = (
    <>
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
            ? bot
              ? t('Invite {name} to this Bot?', { name: names[0] })
              : t('Invite {name} to this task?', { name: names[0] })
            : bot
              ? t('Invite {n} people to this Bot?', { n: String(uninvited.length) })
              : t('Invite {n} people to this task?', { n: String(uninvited.length) })
        }
        description={
          bot
            ? t('You mentioned {names}, but they are not in this Bot yet.', {
                names: names.join(', '),
              })
            : t('You mentioned {names}, but they are not in this task yet.', {
                names: names.join(', '),
              })
        }
        confirmLabel={t('Invite')}
        cancelLabel={t("Don't invite")}
        onConfirm={async () => {
          if (!scope?.sessionId) return
          const { sessionId, teamId } = scope
          const ids = uninvited.map((member) => member.id)
          const invite = (grantComputerUse?: boolean) =>
            api
              .agentInviteConversationParticipants(sessionId, teamId, ids, grantComputerUse)
              .then(() => announceTimelineChange(sessionId))

          await invite().catch((err: unknown) => {
            if (!needsComputerUse(err)) throw err
            setComputerUse({ count: ids.length, confirm: () => invite(true) })
          })
        }}
        onClose={() => setUninvited([])}
      />
      <ComputerUseConfirm request={computerUse} onClose={() => setComputerUse(null)} />
    </>
  )

  return { onInput, onKeyDown, wrapSend, ui }
}
