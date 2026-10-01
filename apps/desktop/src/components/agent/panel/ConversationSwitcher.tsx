import { History, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../../../api'
import { useAgentUnreadSessions } from '../../../lib/agentUnreadSessions'
import { SearchBox } from '../../Toolbar'
import { Menu, MenuContent, MenuTrigger } from '../../ui/menu'
import { toast } from '../../ui/toast'

import { CONVERSATION_SWITCHER_LIMIT } from './constants'
import { HistoryConversationRow } from './historyRows'

import type { AgentConversation } from '../../../api'

/**
 * Where a conversation came from, as a dot on the sender's avatar — the same
 * shorthand a chat app uses for a presence or platform marker. The ring is the
 * pane background, so the dot reads as sitting above the avatar rather than
 * drawing a border of its own.
 */
/**
 * Switch conversations without leaving the page — the docked panel's answer to
 * "show me the others". The Agent page has the rail for this; from the sidebar
 * that list is somewhere else entirely, and going to fetch it would throw away
 * the page you docked the panel to read in the first place.
 *
 * Deliberately lighter than the rail: your own recent conversations, a search
 * box because a menu can only hold so many, and no member filter — this is a
 * switcher for the work in front of you, not the place you go looking through
 * the team's.
 */
export function ConversationSwitcher({
  teamId,
  activeSessionId,
  onPick,
}: {
  teamId: string
  activeSessionId: string | null
  onPick: (sessionId: string, titleHint?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [items, setItems] = useState<AgentConversation[] | null>(null)
  const [loading, setLoading] = useState(false)
  const unreadSessions = useAgentUnreadSessions()

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250)

    return () => window.clearTimeout(timer)
  }, [query])

  // Fetched per opening, so a conversation started elsewhere since last time is
  // there. Search is server-side — the menu holds a page, not the whole list.
  const requestIdRef = useRef(0)
  const switcherKey = `${open ? '1' : '0'}|${teamId}|${debouncedQuery}`
  const [loadingSwitcherKey, setLoadingSwitcherKey] = useState(switcherKey)

  if (switcherKey !== loadingSwitcherKey) {
    setLoadingSwitcherKey(switcherKey)
    if (open) setLoading(true)
  }

  useEffect(() => {
    if (!open) return
    const requestId = ++requestIdRef.current

    void api
      .agentListConversations(teamId, {
        limit: CONVERSATION_SWITCHER_LIMIT,
        scope: 'mine',
        search: debouncedQuery || undefined,
      })
      .then((page) => {
        if (requestIdRef.current !== requestId) return
        setItems(page.conversations)
      })
      .catch((err: unknown) => {
        if (requestIdRef.current !== requestId) return
        toast.apiError('Failed to load conversations', err)
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false)
      })
  }, [open, teamId, debouncedQuery])

  return (
    <Menu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <MenuTrigger
        className="flex h-7 w-7 items-center justify-center rounded-md text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main data-[popup-open]:bg-zGray-800/60 data-[popup-open]:text-main"
        title="Switch conversation"
        aria-label="Switch conversation"
      >
        <History className="h-3.5 w-3.5" strokeWidth={1.8} />
      </MenuTrigger>
      <MenuContent side="bottom" align="end" className="w-[300px]">
        {/* Menus carry a flat `p-1`; the search box needs the same breathing
            room top and bottom, or it reads as pushed against the lid. */}
        <div className="px-1.5 pb-1.5 pt-1.5">
          <SearchBox filter={query} onFilterChange={setQuery} fill label="Search conversations" />
        </div>
        <div className="max-h-[320px] overflow-y-auto scrollbar-thin px-1 pb-1">
          {loading && items === null && (
            <div className="flex items-center gap-2 px-2 py-2 text-[12.5px] text-tertiary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              Loading…
            </div>
          )}
          {items?.length === 0 && (
            <div className="px-2 py-2 text-[12.5px] text-tertiary">
              {debouncedQuery ? 'No conversations match your search.' : 'No conversations yet.'}
            </div>
          )}
          {items?.map((conversation) => (
            <HistoryConversationRow
              key={conversation.sessionId}
              conversation={conversation}
              unread={unreadSessions.has(conversation.sessionId)}
              opening={false}
              selected={conversation.sessionId === activeSessionId}
              compact
              titleClassName="text-[12.5px]"
              timeClassName="mt-0.5"
              avatarSize={20}
              onOpenConversation={(sessionId, titleHint) => {
                setOpen(false)
                onPick(sessionId, titleHint)
              }}
            />
          ))}
        </div>
      </MenuContent>
    </Menu>
  )
}
