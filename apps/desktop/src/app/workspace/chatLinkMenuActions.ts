import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes.ts'
import { isAppWebUrl } from '../../lib/webBaseUrl.ts'

import type { ChatLinkMenuActions } from '../../components/agent/chatLinkMenuContext.ts'

export type ChatLinkMenuDeps = {
  teamId: string | null | undefined
  copyLink: (href: string) => Promise<void>
  openExternalLink: (url: string) => void
  openNuphosLinkFromChat: (href: string) => boolean
  openNuphosLinkInNewTab: (href: string) => boolean
}

// A relative `/teams/...` link resolves against the web origin; anything else
// is already absolute.
function absolute(href: string): string {
  return isAppWebUrl(href.trim())?.toString() ?? href.trim()
}

// Right-click menu on a chat link. "Open in Nuphos" is the left-click routing,
// except that a plain web page lands in the built-in browser tab instead of the
// system browser; the other entries always act on the absolute URL.
export function buildChatLinkMenuActions({
  teamId,
  copyLink,
  openExternalLink,
  openNuphosLinkFromChat,
  openNuphosLinkInNewTab,
}: ChatLinkMenuDeps): ChatLinkMenuActions {
  return {
    openInApp: (href) => {
      if (openNuphosLinkFromChat(href)) return
      const url = absolute(href)

      if (!teamId || !/^https?:\/\//i.test(url)) {
        openExternalLink(url)

        return
      }
      openNuphosLinkInNewTab(
        pageLocationForNavigation(
          emptyNavigation({ kind: 'team', teamId }, 'team.browser', { browserUrl: url }),
        ).href,
      )
    },
    openExternal: (href) => openExternalLink(absolute(href)),
    copyLink: (href) => void copyLink(absolute(href)),
  }
}
