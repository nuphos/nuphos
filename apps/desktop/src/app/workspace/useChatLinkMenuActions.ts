import { useMemo } from 'react'

import { buildChatLinkMenuActions } from './chatLinkMenuActions'

import type { ChatLinkMenuDeps } from './chatLinkMenuActions'
import type { ChatLinkMenuActions } from '../../components/agent/chatLinkMenuContext'

export function useChatLinkMenuActions({
  teamId,
  copyLink,
  openExternalLink,
  openNuphosLinkFromChat,
  openNuphosLinkInNewTab,
}: ChatLinkMenuDeps): ChatLinkMenuActions {
  return useMemo(
    () =>
      buildChatLinkMenuActions({
        teamId,
        copyLink,
        openExternalLink,
        openNuphosLinkFromChat,
        openNuphosLinkInNewTab,
      }),
    [copyLink, openExternalLink, openNuphosLinkFromChat, openNuphosLinkInNewTab, teamId],
  )
}
