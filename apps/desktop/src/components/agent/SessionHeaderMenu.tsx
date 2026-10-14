import {
  Archive,
  ChevronRight,
  Copy,
  GitBranch,
  Hash,
  Link2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { copyLinkWithFeedback } from '../../lib/copyLink'
import { sessionShortcutCombo } from '../../lib/sessionShortcuts'
import {
  addSidebarFavorite,
  favoriteIdentity,
  readSidebarFavorites,
  removeSidebarFavorite,
  subscribeSidebarFavorites,
} from '../../lib/sidebarFavorites'
import { favoriteSessionId, favoriteToggleTitle } from '../../lib/sidebarPinnedChats'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuTrigger,
} from '../ui/menu'
import { ShortcutHint } from '../ui/shortcut-hint'
import { toast } from '../ui/toast'
import { Tooltip } from '../ui/tooltip'

import { agentSessionUrl } from './sessionUrl'
import { useArchiveSession } from './useArchiveSession'

type Props = {
  sessionId: string
  teamId: string
  userId: string
  title: string
  canRename: boolean
  canArchive: boolean
  /** This pane owns the keyboard: its chat is the one the shortcuts act on. */
  shortcutsActive: boolean
  onRename: () => void
  /** Opens a writable copy of this chat (the Plans page's fork path). */
  onFork: () => void
  /** False for read-only (audit) views, which must never offer a fork. */
  canFork: boolean
}

function findPin(userId: string, teamId: string, sessionId: string) {
  return readSidebarFavorites(userId, teamId).find(
    (entry) => favoriteSessionId(entry) === sessionId,
  )
}

/** The sidebar pin for this chat, whichever identity it was pinned under. */
function useSessionPin(userId: string, teamId: string, sessionId: string) {
  const [pin, setPin] = useState(() => findPin(userId, teamId, sessionId))

  useEffect(
    () =>
      subscribeSidebarFavorites(userId, teamId, () => setPin(findPin(userId, teamId, sessionId))),
    [sessionId, teamId, userId],
  )

  return pin
}

/** Titlebar "⋯" beside Share: the sidebar row's session actions for the open chat. */
export function SessionHeaderMenu({
  sessionId,
  teamId,
  userId,
  title,
  canRename,
  canArchive,
  shortcutsActive,
  onRename,
  onFork,
  canFork,
}: Props) {
  const { archiving, archive } = useArchiveSession({ sessionId, teamId, title })
  const pin = useSessionPin(userId, teamId, sessionId)
  // Rename waits for the popup to finish closing; otherwise focus returning to
  // the trigger blurs the title input, and blur saves and closes it.
  const renameOnClose = useRef(false)

  function togglePin() {
    if (pin) {
      removeSidebarFavorite(userId, teamId, favoriteIdentity(pin))

      return
    }
    const href = pageLocationForNavigation(
      emptyNavigation({ kind: 'team', teamId }, 'team.agent', { agentSessionId: sessionId }),
    ).href

    addSidebarFavorite(userId, teamId, { label: title, href })
  }

  function copy(value: string, what: 'Link' | 'Session ID') {
    void copyLinkWithFeedback(value, (text) => navigator.clipboard.writeText(text), {
      onSuccess: () =>
        toast.success(`${what} copied`, undefined, { timeoutMs: 1200, dedupe: false }),
      onError: () => toast.error(`Could not copy ${what.toLowerCase()}`, 'Clipboard was blocked.'),
    })
  }

  // ⌥⌘R, ⌥⌘P, ⇧⌘C and ⇧⌘A run the same actions as the menu items below.
  const onShortcut = useRef<((action: string) => void) | null>(null)

  useLayoutEffect(() => {
    onShortcut.current = (action) => {
      if (action === 'rename-chat' && canRename) onRename()
      else if (action === 'toggle-pin-chat') togglePin()
      else if (action === 'copy-chat-link') copy(agentSessionUrl(teamId, sessionId), 'Link')
      else if (action === 'archive-chat' && canArchive && !archiving) void archive()
    }
  })
  useEffect(() => {
    if (!shortcutsActive || typeof window.api.onAppShortcut !== 'function') return

    return window.api.onAppShortcut((action) => onShortcut.current?.(action))
  }, [shortcutsActive])

  return (
    <Menu
      onOpenChangeComplete={(open) => {
        if (open || !renameOnClose.current) return
        renameOnClose.current = false
        onRename()
      }}
    >
      <Tooltip content="More actions" side="bottom">
        <MenuTrigger
          aria-label="More chat actions"
          className="titlebar-no-drag ml-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main data-[popup-open]:bg-zGray-800/60 data-[popup-open]:text-main motion-reduce:transition-none"
        >
          <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        </MenuTrigger>
      </Tooltip>
      <MenuContent align="end" className="w-max min-w-[200px]">
        {canRename && (
          <MenuItem
            icon={<Pencil className="h-3.5 w-3.5" />}
            hint={<ShortcutHint combo={sessionShortcutCombo('rename-chat')} className="pl-4" />}
            onClick={() => {
              renameOnClose.current = true
            }}
          >
            Rename chat
          </MenuItem>
        )}
        <MenuItem
          icon={pin ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          hint={<ShortcutHint combo={sessionShortcutCombo('toggle-pin-chat')} className="pl-4" />}
          onClick={togglePin}
        >
          {favoriteToggleTitle(true, Boolean(pin))}
        </MenuItem>
        {canFork && (
          <MenuItem icon={<GitBranch className="h-3.5 w-3.5" />} onClick={onFork}>
            Fork chat
          </MenuItem>
        )}
        <MenuSubmenu>
          <MenuSubmenuTrigger
            icon={<Copy className="h-3.5 w-3.5" />}
            chevron={<ChevronRight className="h-3 w-3" />}
          >
            Copy
          </MenuSubmenuTrigger>
          <MenuContent align="start" className="w-max min-w-[180px]">
            <MenuItem
              icon={<Link2 className="h-3.5 w-3.5" />}
              hint={
                <ShortcutHint combo={sessionShortcutCombo('copy-chat-link')} className="pl-4" />
              }
              onClick={() => copy(agentSessionUrl(teamId, sessionId), 'Link')}
            >
              Link
            </MenuItem>
            <MenuItem
              icon={<Hash className="h-3.5 w-3.5" />}
              onClick={() => copy(sessionId, 'Session ID')}
            >
              Session ID
            </MenuItem>
          </MenuContent>
        </MenuSubmenu>
        {canArchive && (
          <>
            <MenuSeparator />
            <MenuItem
              icon={<Archive className="h-3.5 w-3.5" />}
              hint={<ShortcutHint combo={sessionShortcutCombo('archive-chat')} className="pl-4" />}
              disabled={archiving}
              onClick={() => void archive()}
            >
              {archiving ? 'Archiving…' : 'Archive chat'}
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  )
}
