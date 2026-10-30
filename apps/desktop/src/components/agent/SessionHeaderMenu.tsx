import {
  Archive,
  Bell,
  BellOff,
  ChevronRight,
  Copy,
  GitBranch,
  Hash,
  Link2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { toggleChatSummary, useChatSummaryOpen } from '../../lib/chatSummaryPanel'
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
import { SummaryIcon } from './summary/ChatSummaryToggle'
import { useArchiveSession } from './useArchiveSession'

const pane = useWorkspacePane()

type Props = {
  sessionId: string
  teamId: string
  userId: string
  title: string
  canRename: boolean
  canArchive: boolean
  /** The viewer gets this chat's push notifications; absent hides the toggle. */
  watching?: boolean
  /** This pane owns the keyboard: its chat is the one the shortcuts act on. */
  shortcutsActive: boolean
  onRename: () => void
  /** Opens a writable copy of this chat (the Plans page's fork path). */
  onFork: () => void
  /** False for read-only (audit) views, which must never offer a fork. */
  canFork: boolean
  /** Closes this pane of a split window, as ⌘W does; absent when it is the only pane. */
  onClosePane?: () => void
  /** The pane is too narrow for the summary button, so the menu offers it. */
  summaryInMenu?: boolean
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
  watching: reportedWatching,
  shortcutsActive,
  onRename,
  onFork,
  canFork,
  onClosePane,
  summaryInMenu = false,
}: Props) {
  const { archiving, archive } = useArchiveSession({ sessionId, teamId, title })
  const summaryOpen = useChatSummaryOpen(pane.paneId)
  const pin = useSessionPin(userId, teamId, sessionId)
  // What the server said when the chat opened; a toggle here wins after that.
  const [toggled, setToggled] = useState<boolean | undefined>(undefined)
  const watching = toggled ?? reportedWatching

  function toggleWatch() {
    const next = !watching

    setToggled(next)
    void api.agentSetConversationWatched(sessionId, next, teamId).catch((err: unknown) => {
      setToggled(!next)
      toast.apiError(next ? t('Could not watch agent') : t('Could not unwatch agent'), err)
    })
  }
  // Rename waits for the popup to finish closing; otherwise focus returning to
  // the trigger blurs the title input, and blur saves and closes it.
  const renameOnClose = useRef(false)
  // Closing the pane waits too: the menu hands focus back to its trigger in this
  // pane, which would make the closed pane the active one again.
  const closePaneOnClose = useRef(false)

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

  function copy(value: string, what: 'Link' | 'Agent ID') {
    void copyLinkWithFeedback(value, (text) => navigator.clipboard.writeText(text), {
      onSuccess: () =>
        toast.success(what === 'Link' ? t('Link copied') : t('Agent ID copied'), undefined, {
          timeoutMs: 1200,
          dedupe: false,
        }),
      onError: () =>
        toast.error(
          what === 'Link' ? t('Could not copy link') : t('Could not copy agent id'),
          t('Clipboard was blocked.'),
        ),
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
    // The main process swallows these combos only while a visible chat owns them.
    window.api.setSessionShortcutsActive(true)
    const off = window.api.onAppShortcut((action) => onShortcut.current?.(action))

    return () => {
      off()
      window.api.setSessionShortcutsActive(false)
    }
  }, [shortcutsActive])

  return (
    <Menu
      onOpenChangeComplete={(open) => {
        if (open) return
        if (closePaneOnClose.current) {
          closePaneOnClose.current = false
          onClosePane?.()
        }
        if (!renameOnClose.current) return
        renameOnClose.current = false
        onRename()
      }}
    >
      <Tooltip content={t('More actions')} side="bottom">
        <MenuTrigger
          aria-label={t('More agent actions')}
          className="titlebar-no-drag ml-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main data-[popup-open]:bg-zGray-800/60 data-[popup-open]:text-main motion-reduce:transition-none"
        >
          <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        </MenuTrigger>
      </Tooltip>
      <MenuContent align="end" className="w-max min-w-[200px]">
        {summaryInMenu && (
          <>
            <MenuItem
              icon={<SummaryIcon />}
              hint={<ShortcutHint combo="mod+i" className="pl-4" />}
               onClick={() => toggleChatSummary(pane.paneId)}
            >
              {summaryOpen ? t('Hide agent summary') : t('Show agent summary')}
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        {canRename && (
          <MenuItem
            icon={<Pencil className="h-3.5 w-3.5" />}
            hint={<ShortcutHint combo={sessionShortcutCombo('rename-chat')} className="pl-4" />}
            onClick={() => {
              renameOnClose.current = true
            }}
          >
            {t('Rename agent')}
          </MenuItem>
        )}
        <MenuItem
          icon={pin ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          hint={<ShortcutHint combo={sessionShortcutCombo('toggle-pin-chat')} className="pl-4" />}
          onClick={togglePin}
        >
          {favoriteToggleTitle(true, Boolean(pin))}
        </MenuItem>
        {watching !== undefined && (
          <MenuItem
            icon={watching ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
            onClick={toggleWatch}
          >
            {watching ? t('Unwatch agent') : t('Watch agent')}
          </MenuItem>
        )}
        {canFork && (
          <MenuItem icon={<GitBranch className="h-3.5 w-3.5" />} onClick={onFork}>
            {t('Fork agent')}
          </MenuItem>
        )}
        <MenuSubmenu>
          <MenuSubmenuTrigger
            icon={<Copy className="h-3.5 w-3.5" />}
            chevron={<ChevronRight className="h-3 w-3" />}
          >
            {t('Copy')}
          </MenuSubmenuTrigger>
          <MenuContent align="start" className="w-max min-w-[180px]">
            <MenuItem
              icon={<Link2 className="h-3.5 w-3.5" />}
              hint={
                <ShortcutHint combo={sessionShortcutCombo('copy-chat-link')} className="pl-4" />
              }
              onClick={() => copy(agentSessionUrl(teamId, sessionId), 'Link')}
            >
              {t('Link')}
            </MenuItem>
            <MenuItem
              icon={<Hash className="h-3.5 w-3.5" />}
              onClick={() => copy(sessionId, 'Agent ID')}
            >
              {t('Agent ID')}
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
              {archiving ? t('Archiving…') : t('Archive agent')}
            </MenuItem>
          </>
        )}
        {onClosePane && (
          <>
            <MenuSeparator />
            <MenuItem
              icon={<X className="h-3.5 w-3.5" />}
              hint={<ShortcutHint combo="mod+w" className="pl-4" />}
              onClick={() => {
                closePaneOnClose.current = true
              }}
            >
              {t('Close pane')}
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  )
}
