import { Archive, Link2, MoreHorizontal, Pencil, Pin, PinOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { copyLinkWithFeedback } from '../../lib/copyLink'
import {
  addSidebarFavorite,
  favoriteIdentity,
  readSidebarFavorites,
  removeSidebarFavorite,
  subscribeSidebarFavorites,
} from '../../lib/sidebarFavorites'
import { favoriteSessionId, favoriteToggleTitle } from '../../lib/sidebarPinnedChats'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/menu'
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
  onRename: () => void
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
  onRename,
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

  function copyLink() {
    void copyLinkWithFeedback(
      agentSessionUrl(teamId, sessionId),
      (value) => navigator.clipboard.writeText(value),
      {
        onSuccess: () =>
          toast.success('Link copied', undefined, { timeoutMs: 1200, dedupe: false }),
        onError: () => toast.error('Could not copy link', 'Clipboard was blocked.'),
      },
    )
  }

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
      <MenuContent align="end" className="w-[200px]">
        {canRename && (
          <MenuItem
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => {
              renameOnClose.current = true
            }}
          >
            Rename chat
          </MenuItem>
        )}
        <MenuItem
          icon={pin ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          onClick={togglePin}
        >
          {favoriteToggleTitle(true, Boolean(pin))}
        </MenuItem>
        <MenuItem icon={<Link2 className="h-3.5 w-3.5" />} onClick={copyLink}>
          Copy link
        </MenuItem>
        {canArchive && (
          <>
            <MenuSeparator />
            <MenuItem
              icon={<Archive className="h-3.5 w-3.5" />}
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
