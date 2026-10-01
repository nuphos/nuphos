import clsx from 'clsx'
import { ListFilter, Loader2, PanelLeftClose, PanelLeftOpen, Users } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../api'
import { AgentHistoryPage } from '../components/agent/AgentPanel'
import { Avatar } from '../components/Avatar'
import { SearchBox } from '../components/Toolbar'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../components/ui/menu'
import { toast } from '../components/ui/toast'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'

import { useResetOnKey } from './useResetOnKey'

import type { TeamMember } from '../types'

const RAIL_WIDTH = 320

type Props = {
  teamId: string
  /** Marks the viewer's own row in the member filter. */
  currentUserId: string
  /** Bumped by the toolbar's refresh button. */
  refreshKey?: number
  /** The conversation the page is showing, so its row reads as selected. */
  selectedSessionId: string | null
  /** Opens a conversation in the page beside this list. */
  onOpenConversation: (sessionId: string, title: string) => void
  /** ⌘-click on a row: open the conversation in a tab of its own. */
  onOpenConversationInNewTab: (sessionId: string, title: string) => void
  onExpand: () => void
  onCollapse: () => void
  /** Hidden, but still mounted so collapsing animates out. */
  collapsed: boolean
}

/**
 * Every conversation in the team, personal and shared, beside the one being
 * read. Selecting a row swaps the conversation next to it — the list keeps its
 * scroll, its search and its filter throughout, which is the whole point of it
 * being here rather than on a page you leave to read anything.
 *
 * Search and the member filter live at the top of the rail rather than in the
 * workspace Toolbar: they filter this list, and from the Toolbar they read as
 * filtering the conversation beside it too.
 */
export function ConversationRail({
  teamId,
  currentUserId,
  refreshKey,
  selectedSessionId,
  onOpenConversation,
  onOpenConversationInNewTab,
  onExpand,
  onCollapse,
  collapsed,
}: Props) {
  const { isActive } = useWorkspaceTab()
  const [query, setQuery] = useState('')
  // Everyone by default: the rail is the one place a team's conversations are
  // all reachable, and opening it on your own hides most of what it is for.
  // Narrowing to one person — yourself included — is what the filter is for.
  const [owner, setOwner] = useState<TeamMember | null>(null)
  // Nothing inside is built — and no conversations are fetched — until the rail
  // is first opened. It stays mounted afterwards so closing it animates out
  // rather than vanishing.
  const [everOpened, setEverOpened] = useState(!collapsed)

  useResetOnKey(String(collapsed), () => {
    if (!collapsed) setEverOpened(true)
  })

  return (
    <div
      // The button and the opaque rail cover share one isolated stacking
      // context. As this wrapper narrows, the cover reveals the button beneath
      // it instead of letting a sibling surface appear above the animation.
      className="t-resize relative isolate z-20 min-h-0 flex-shrink-0 overflow-visible"
      style={{ width: collapsed ? 0 : RAIL_WIDTH }}
    >
      <button
        onClick={onExpand}
        disabled={!collapsed}
        aria-hidden={!collapsed}
        className="surface-raised absolute left-2 top-2 z-0 flex h-8 items-center gap-1.5 rounded-lg bg-agentCanvas px-2.5 text-[12.5px] text-tertiary transition-colors hover:text-main"
        title="Show conversations"
        aria-label="Show conversations"
      >
        <PanelLeftOpen className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.8} />
        <span className="whitespace-nowrap">All chats</span>
      </button>
      <div
        className="absolute inset-y-0 left-0 z-10 overflow-hidden bg-agentCanvas"
        style={{ width: '100%' }}
        aria-hidden={collapsed}
      >
        {everOpened && (
          <div
            className="flex h-full min-h-0 flex-col border-r border-zGray-800/70"
            style={{ width: RAIL_WIDTH }}
          >
            <div className="flex flex-shrink-0 items-center gap-1.5 px-2.5 pb-2 pt-2.5">
              <SearchBox
                filter={query}
                onFilterChange={setQuery}
                fill
                label="Search conversations"
              />
              <MemberFilter
                teamId={teamId}
                currentUserId={currentUserId}
                value={owner}
                onChange={setOwner}
              />
              <button
                onClick={onCollapse}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-zGray-800/60 hover:text-main"
                title="Hide conversations"
                aria-label="Hide conversations"
              >
                <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </div>
            <AgentHistoryPage
              teamId={teamId}
              refreshKey={refreshKey}
              query={query}
              openingSessionId={null}
              selectedSessionId={selectedSessionId}
              layout="rail"
              onOpenConversation={(sessionId, titleHint, newTab) => {
                const title = titleHint || 'Chat'

                if (newTab) onOpenConversationInNewTab(sessionId, title)
                else onOpenConversation(sessionId, title)
              }}
              historyScope="team"
              ownerId={owner?.id ?? null}
              // A hidden list must not answer the arrow keys.
              keyboardNavigation={isActive && !collapsed}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function MemberFilter({
  teamId,
  currentUserId,
  value,
  onChange,
}: {
  teamId: string
  currentUserId: string
  value: TeamMember | null
  onChange: (member: TeamMember | null) => void
}) {
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    if (members || loading) return
    setLoading(true)
    api
      .atlasListTeamMembers(teamId)
      .then(setMembers)
      .catch((err: unknown) => toast.apiError('Failed to load team members', err))
      .finally(() => setLoading(false))
  }, [loading, members, teamId])

  const label = value ? `Showing ${value.name}'s chats` : 'Everyone in the team'

  return (
    <Menu onOpenChange={(open) => open && load()}>
      <MenuTrigger
        className={clsx(
          'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors',
          'data-[popup-open]:bg-zGray-800/60 data-[popup-open]:text-main hover:bg-zGray-800/60',
          value ? 'text-zViolet-accent' : 'text-tertiary hover:text-main',
        )}
        title={label}
        aria-label={label}
      >
        {value ? (
          <Avatar src={value.avatarURL} name={value.name} size={18} className="rounded-full" />
        ) : (
          <ListFilter className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </MenuTrigger>
      <MenuContent align="end" className="w-[240px]">
        <MenuItem
          icon={<Users className="h-3.5 w-3.5" strokeWidth={1.8} />}
          selected={!value}
          onClick={() => onChange(null)}
        >
          Everyone in the team
        </MenuItem>
        {loading && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-tertiary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            Loading members…
          </div>
        )}
        {members?.map((member) => (
          <MenuItem
            key={member.id}
            icon={
              <Avatar
                src={member.avatarURL}
                name={member.name}
                size={16}
                className="rounded-full"
              />
            }
            selected={value?.id === member.id}
            onClick={() => onChange(member)}
          >
            <span className="truncate">
              {member.name}
              {member.id === currentUserId && <span className="text-tertiary"> (you)</span>}
            </span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}
