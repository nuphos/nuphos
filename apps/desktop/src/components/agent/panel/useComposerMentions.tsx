import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { participantsQuery, teamMembersQuery } from '../../../lib/query/team'
import { agentSessionsQuery } from '../../sidebar/agentSessions'
import { AppAlertDialog } from '../../ui/alert-dialog'
import { needsComputerUse } from '../computerUse'
import { ComputerUseConfirm } from '../ComputerUseConfirm'

import { matchDevices, matchMembers, matchSessions, mentionQuery } from './composerMention'
import { mentionedMembers, optionChip } from './composerMentionChips'
import { MentionPicker } from './composerMentionOptions'
import { announceTimelineChange } from './timelineEvents'

import type { ComputerUseRequest } from '../computerUse'
import type { ComposerSend, MentionOption } from './composerMentionChips'
import type { CredentialSelectorControl } from './credentialSections'
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
    /** A chat's own people and agents: only those people are offered, and not the sender. */
    only?: { agentIds: string[]; selfId: string }
  },
  credentials?: Pick<CredentialSelectorControl, 'options' | 'value' | 'onChange'>,
) {
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [anchor, setAnchor] = useState<{
    getBoundingClientRect: () => DOMRect
    contextElement: HTMLElement
  } | null>(null)
  const [uninvited, setUninvited] = useState<TeamMember[]>([])
  const [computerUse, setComputerUse] = useState<ComputerUseRequest | null>(null)
  // Everything the menu offers is read once and kept fresh in the background —
  // the Chats are the sidebar's own list — and every keystroke only filters it,
  // so the menu opens complete, never section by section.
  const teamId = scope?.teamId ?? ''
  const only = scope?.only
  const channelId = only ? scope.sessionId : undefined
  const team = useQuery({ ...teamMembersQuery(teamId), enabled: Boolean(scope) })
  const access = useQuery({
    ...participantsQuery(teamId, channelId ?? ''),
    enabled: Boolean(channelId),
  })
  const chats = useQuery({ ...agentSessionsQuery(teamId), enabled: Boolean(scope) })
  const here = channelId ? new Set(access.data?.participants.map((person) => person.id)) : null
  const members = (team.data ?? []).filter(
    (m) => !here || (here.has(m.id) && m.id !== only?.selfId),
  )
  const loading = team.isLoading || access.isLoading || chats.isLoading
  const matches: MentionOption[] =
    query === null || loading
      ? []
      : [
          ...matchMembers(members, query).map((member): MentionOption => ({
            kind: 'member',
            member,
          })),
          ...matchDevices(credentials?.options.devices ?? [], query).map(
            (device): MentionOption => ({ kind: 'device', device }),
          ),
          ...matchSessions(chats.data ?? [], query, scope?.sessionId).map(
            (session): MentionOption => ({ kind: 'session', session }),
          ),
        ]

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
  }

  function select(option: MentionOption) {
    const el = editorRef.current
    const caret = el && caretText(el)

    if (!caret || query === null || !scope) return
    const range = document.createRange()

    range.setStart(caret.node, caret.offset - query.length - 1)
    range.setEnd(caret.node, caret.offset)
    range.deleteContents()
    const chip = optionChip(option, scope.teamId, scope.only?.agentIds)

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
    const { participants, shareable } = await api.agentGetConversationParticipants(
      scope.sessionId,
      scope.teamId,
    )
    const joined = new Set(participants.map((participant) => participant.id))

    // Only what may be shared offers to invite: never a Bot or what an agent opened.
    setUninvited(
      shareable === false ? [] : members.filter((m) => ids.includes(m.id) && !joined.has(m.id)),
    )
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
            ? t('Invite {name} to this task?', { name: names[0] })
            : t('Invite {n} people to this task?', { n: String(uninvited.length) })
        }
        description={t('You mentioned {names}, but they are not in this task yet.', {
          names: names.join(', '),
        })}
        confirmLabel={t('Invite')}
        cancelLabel={t("Don't invite")}
        onConfirm={async () => {
          if (!scope?.sessionId) return
          const { sessionId } = scope
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
