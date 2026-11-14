import {
  Archive,
  Bell,
  BellOff,
  Bot,
  BotOff,
  ChevronRight,
  Copy,
  GitBranch,
  Hash,
  Link2,
  MoreHorizontal,
  Pencil,
  SmilePlus,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { usePaneSummary } from '../../app/workspace/usePaneSummary'
import { t } from '../../i18n'
import { useAgentAvatarPick } from '../../lib/agentAvatarChoices'
import { openChangeBotAvatar } from '../../lib/changeBotAvatar'
import { copyLinkWithFeedback } from '../../lib/copyLink'
import { sessionShortcutCombo } from '../../lib/sessionShortcuts'
import { useIsSubAgent } from '../../lib/subAgentIds'
import { makeBot, turnIntoTask } from '../channels/botChannel'
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

type Props = {
  sessionId: string
  teamId: string
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

/** Titlebar "⋯" beside Share: the sidebar row's session actions for the open chat. */
export function SessionHeaderMenu({
  sessionId,
  teamId,
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
  const { open: summaryOpen, toggle: toggleSummary } = usePaneSummary()
  const isBot = Boolean(useAgentAvatarPick(sessionId))
  // A sub-task stays a Task (as a Bot it shows twice); one that is a Bot can still turn back.
  const subAgent = useIsSubAgent(sessionId)
  // What the server said when the chat opened; a toggle here wins after that.
  const [toggled, setToggled] = useState<boolean | undefined>(undefined)
  const watching = toggled ?? reportedWatching

  function toggleWatch() {
    const next = !watching

    setToggled(next)
    void api.agentSetConversationWatched(sessionId, next, teamId).catch((err: unknown) => {
      setToggled(!next)
      toast.apiError(
        isBot
          ? next
            ? t('Could not watch Bot')
            : t('Could not unwatch Bot')
          : next
            ? t('Could not watch task')
            : t('Could not unwatch task'),
        err,
      )
    })
  }
  // "Turn into a Task" takes the face and the chats away; "Make this a Bot" is shared with the row menu.
  const setBot = (bot: boolean) => void (bot ? makeBot : turnIntoTask)(teamId, sessionId)
  // Rename waits for the popup to finish closing; otherwise focus returning to
  // the trigger blurs the title input, and blur saves and closes it.
  const renameOnClose = useRef(false)
  const avatarOnClose = useRef(false)
  // Closing the pane waits too: the menu hands focus back to its trigger in this
  // pane, which would make the closed pane the active one again.
  const closePaneOnClose = useRef(false)

  function copy(value: string, what: 'Link' | 'ID') {
    const copied =
      what === 'Link' ? t('Link copied') : isBot ? t('Bot ID copied') : t('Task ID copied')

    void copyLinkWithFeedback(value, (text) => navigator.clipboard.writeText(text), {
      onSuccess: () =>
        toast.success(copied, undefined, {
          timeoutMs: 1200,
          dedupe: false,
        }),
      onError: () =>
        toast.error(
          what === 'Link'
            ? t('Could not copy link')
            : isBot
              ? t('Could not copy Bot ID')
              : t('Could not copy task ID'),
          t('Clipboard was blocked.'),
        ),
    })
  }

  // ⌥⌘R, ⇧⌘C and ⇧⌘A run the same actions as the menu items below.
  const onShortcut = useRef<((action: string) => void) | null>(null)

  useLayoutEffect(() => {
    onShortcut.current = (action) => {
      if (action === 'rename-chat' && canRename) onRename()
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
        if (avatarOnClose.current) {
          avatarOnClose.current = false
          openChangeBotAvatar({ teamId, botId: sessionId, title })
        }
        if (!renameOnClose.current) return
        renameOnClose.current = false
        onRename()
      }}
    >
      <Tooltip content={t('More actions')} side="bottom">
        <MenuTrigger
          aria-label={t('More actions')}
          className="titlebar-no-drag ml-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-state-hover hover:text-main data-[popup-open]:bg-state-selected data-[popup-open]:text-main motion-reduce:transition-none"
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
              onClick={toggleSummary}
            >
              {summaryOpen ? t('Hide summary') : t('Show summary')}
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
            {isBot ? t('Rename Bot') : t('Rename task')}
          </MenuItem>
        )}
        {canRename && isBot && (
          <MenuItem
            icon={<SmilePlus className="h-3.5 w-3.5" />}
            onClick={() => {
              avatarOnClose.current = true
            }}
          >
            {t('Change avatar')}
          </MenuItem>
        )}
        {canRename && (isBot || !subAgent) && (
          <MenuItem
            icon={isBot ? <BotOff className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
            onClick={() => setBot(!isBot)}
          >
            {isBot ? t('Turn into a Task') : t('Make this a Bot')}
          </MenuItem>
        )}
        {watching !== undefined && (
          <MenuItem
            icon={watching ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
            onClick={toggleWatch}
          >
            {watching
              ? isBot
                ? t('Unwatch Bot')
                : t('Unwatch task')
              : isBot
                ? t('Watch Bot')
                : t('Watch task')}
          </MenuItem>
        )}
        {canFork && (
          <MenuItem icon={<GitBranch className="h-3.5 w-3.5" />} onClick={onFork}>
            {isBot ? t('Fork Bot') : t('Fork task')}
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
            <MenuItem icon={<Hash className="h-3.5 w-3.5" />} onClick={() => copy(sessionId, 'ID')}>
              {isBot ? t('Bot ID') : t('Task ID')}
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
              {archiving ? t('Archiving…') : isBot ? t('Archive Bot') : t('Archive Task')}
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
