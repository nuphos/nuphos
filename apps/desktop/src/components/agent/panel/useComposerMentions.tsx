import clsx from 'clsx'
import { useState } from 'react'

import { api } from '../../../api'
import { Avatar } from '../../Avatar'
import { AppAlertDialog } from '../../ui/alert-dialog'

import { matchMembers, mentionQuery } from './composerMention'
import { announceTimelineChange } from './timelineEvents'

import type { TeamMember } from '../../../types'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

const MENTION_ATTR = 'data-mention-user-id'

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
 * `@` mentions of teammates in the composer: an autocomplete while typing, a
 * chip that sends as `@Name`, and — like Slack — an offer to invite anyone
 * mentioned who is not in the session yet, asked after the message is sent so
 * the message itself never waits on it.
 */
export function useComposerMentions(
  editorRef: RefObject<HTMLDivElement | null>,
  onEdited: () => void,
  scope?: { teamId: string; sessionId?: string },
) {
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [uninvited, setUninvited] = useState<TeamMember[]>([])
  const matches = query === null || !members ? [] : matchMembers(members, query)

  function loadMembers() {
    if (members || !scope) return
    setMembers([])
    api
      .atlasListTeamMembers(scope.teamId)
      .then(setMembers)
      .catch(() => setMembers(null))
  }

  function onInput() {
    const el = editorRef.current
    const caret = el && caretText(el)
    const next = caret && scope ? mentionQuery(caret.node.data.slice(0, caret.offset)) : null

    setQuery(next)
    setActive(0)
    if (next !== null) loadMembers()
  }

  function select(member: TeamMember) {
    const el = editorRef.current
    const caret = el && caretText(el)

    if (!caret || query === null) return
    const range = document.createRange()

    range.setStart(caret.node, caret.offset - query.length - 1)
    range.setEnd(caret.node, caret.offset)
    range.deleteContents()
    const chip = document.createElement('span')

    chip.contentEditable = 'false'
    chip.setAttribute(MENTION_ATTR, member.id)
    chip.className = 'rounded px-0.5 font-medium text-zViolet-accent bg-zViolet-accent/10'
    chip.textContent = `@${member.name || member.email}`
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
      {matches.length > 0 && (
        // The menu dropdown transition (t-dropdown) the app's menus use, growing
        // up from the composer's left edge.
        <div
          role="listbox"
          data-origin="bottom-left"
          className="t-dropdown is-open absolute bottom-full left-0 z-20 mb-2 w-[280px] overflow-hidden rounded-lg border border-zGray-800/60 bg-main p-1 shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)]"
        >
          {matches.map((member, index) => (
            <div
              key={member.id}
              role="option"
              aria-selected={index === active}
              className={clsx(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px]',
                index === active && 'bg-zGray-800/60',
              )}
              // Keep focus (and the caret) in the editor.
              onMouseDown={(e) => {
                e.preventDefault()
                select(member)
              }}
              onMouseEnter={() => setActive(index)}
            >
              <Avatar
                src={member.avatarURL}
                name={member.name}
                size={18}
                className="rounded-full"
              />
              <span className="truncate text-main">{member.name || member.email}</span>
              <span className="ml-auto truncate text-[11.5px] text-tertiary">{member.email}</span>
            </div>
          ))}
        </div>
      )}
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
