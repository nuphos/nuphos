import { createContext } from 'react'

// Actions behind the right-click menu on a link in a chat message. Provided by
// the workspace shell; without a provider (onboarding demo, previews) links
// keep the plain browser context behaviour.
export type ChatLinkMenuActions = {
  // The same routing a left click uses: an app or bound-provider page opens in
  // a workspace tab, anything else opens in the built-in browser tab.
  openInApp: (href: string) => void
  // Always hand the link to the system browser.
  openExternal: (href: string) => void
  copyLink: (href: string) => void
}

export const ChatLinkMenuContext = createContext<ChatLinkMenuActions | null>(null)

// Links the menu can act on: web pages and in-app `/teams/...` paths. Other
// absolute paths (e.g. a file path in the agent's workspace) are not web pages,
// so they and `mailto:` and friends keep the default behaviour.
export function isChatMenuLink(link: string): boolean {
  return /^https?:\/\//i.test(link) || link.startsWith('/teams/')
}
