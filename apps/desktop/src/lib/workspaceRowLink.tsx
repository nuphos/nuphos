import { Link2, MessageSquare } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'

import { ContextMenu } from '../components/ContextMenu'

import type { ContextMenuItem } from '../components/ContextMenu'
import type { ReactNode } from 'react'

// Channel exposed by App.tsx so any table view can:
//  1) compute the canonical link for one of its rows, by overlaying row-specific
//     navigation state onto the current tab's snapshot, and
//  2) trigger the global "copy link" / "open in chat" actions for a link.
//
// Kept in a separate module from App.tsx so views can import it without a
// circular dependency.
//
// Callers can either:
//  - pass an explicit `path` that bypasses the navigation pipeline (used when
//    the link is a fully-formed sub-path like ".../ec2-instances/<id>"), or
//  - pass NavigationSnapshot fields (`active`, `target`, etc.) that get
//    overlaid onto the current tab's snapshot.
export type RowLinkOverride = {
  path?: string
  active?: string
  target?: { kind: string; namespace: string | null; name: string } | null
  [k: string]: unknown
}

export type WorkspaceRowLinkValue = {
  // Build a full href ("/teams/.../...") from the current tab's navigation,
  // overlaying any row-specific overrides.
  linkForRow: (override: RowLinkOverride) => string
  // Write a link to the clipboard. Resolves once the clipboard is updated.
  copyLink: (href: string) => Promise<void>
  // Push a link into the agent chat composer (no auto-send). Opens / docks the
  // chat panel as a side effect.
  openInChat: (href: string) => void
}

// The provider lives in `WorkspaceRowLinkProvider.tsx` — a module that exports
// a component alongside hooks/constants breaks Fast Refresh.
export const WorkspaceRowLinkContext = createContext<WorkspaceRowLinkValue | null>(null)

export function useWorkspaceRowLink(): WorkspaceRowLinkValue {
  const value = useContext(WorkspaceRowLinkContext)

  if (!value) {
    // Outside the workspace (e.g. login screen) — return a no-op so views can
    // still render without throwing.
    return {
      linkForRow: () => '',
      copyLink: async () => undefined,
      openInChat: () => undefined,
    }
  }

  return value
}

// Hook used by table views. Given a function that maps a row to a link, returns
// a builder that emits the two universal context-menu items (Copy link, Open in
// chat) for that row. Returns `null` items when the row has no link, so views
// can `.filter(Boolean)` them out.
export function useRowLinkActions<T>(
  getLink: ((row: T) => string | null) | null | undefined,
): (row: T) => ContextMenuItem[] {
  const { copyLink, openInChat } = useWorkspaceRowLink()

  return useMemo(
    () => (row: T) => {
      if (!getLink) return []
      const href = getLink(row)

      if (!href) return []

      return [
        {
          key: 'copy-link',
          label: 'Copy link',
          icon: Link2,
          onSelect: () => void copyLink(href),
        },
        {
          key: 'open-in-chat',
          label: 'Open in chat',
          icon: MessageSquare,
          onSelect: () => openInChat(href),
        },
      ]
    },
    [getLink, copyLink, openInChat],
  )
}

// Convenience helper for table views that have NO view-specific context-menu
// items — only the universal link actions. Returns the props to forward to
// <Table> plus a rendered menu element to mount above it.
export function useLinkOnlyRowMenu<T>(getLink: ((row: T) => string | null) | null | undefined): {
  onRowContextMenu: (row: T, e: { clientX: number; clientY: number }) => void
  menu: ReactNode
} {
  const linkActions = useRowLinkActions(getLink)
  const [open, setOpen] = useState<{ row: T; x: number; y: number } | null>(null)

  const onRowContextMenu = useCallback((row: T, e: { clientX: number; clientY: number }) => {
    setOpen({ row, x: e.clientX, y: e.clientY })
  }, [])

  const items = open ? linkActions(open.row) : []
  const menu =
    open && items.length > 0 ? (
      <ContextMenu x={open.x} y={open.y} items={items} onClose={() => setOpen(null)} />
    ) : null

  return { onRowContextMenu, menu }
}
