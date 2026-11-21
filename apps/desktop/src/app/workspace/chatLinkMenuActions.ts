import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes.ts'
import { isAppWebUrl } from '../../lib/webBaseUrl.ts'

import type { ChatLinkMenuActions } from '../../components/agent/chatLinkMenuContext.ts'

export type ChatLinkMenuDeps = {
  teamId: string | null | undefined
  resolveExternalLink?: (href: string) => Promise<string>
  copyLink: (href: string) => Promise<void>
  openExternalLink: (url: string) => void
  openNuphosLinkFromChat: (href: string, beside?: boolean) => boolean
  openNuphosLinkInNewTab: (href: string) => boolean
}

// A relative `/teams/...` link resolves against the web origin; anything else
// is already absolute.
function absolute(href: string): string {
  return isAppWebUrl(href.trim())?.toString() ?? href.trim()
}

// Right-click menu on a chat link. "Open in Nuphos" is the left-click routing,
// except that a plain web page lands in the built-in browser tab instead of the
// system browser; external/copy actions resolve the provider URL when available.
export function buildChatLinkMenuActions({
  teamId,
  resolveExternalLink,
  copyLink,
  openExternalLink,
  openNuphosLinkFromChat,
  openNuphosLinkInNewTab,
}: ChatLinkMenuDeps): ChatLinkMenuActions {
  function external(href: string, act: (url: string) => void) {
    if (!resolveExternalLink) {
      act(absolute(href))

      return
    }
    void resolveExternalLink(href).then(act, () => act(absolute(href)))
  }

  return {
    open: openNuphosLinkFromChat,
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
    openExternal: (href) => external(href, openExternalLink),
    copyLink: (href) => external(href, (url) => void copyLink(url)),
  }
}
