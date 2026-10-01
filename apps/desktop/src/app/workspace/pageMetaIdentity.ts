import type { WorkspacePageMeta } from '../workspaceTabState'

export function pageMetaIdentityMatches(
  current: WorkspacePageMeta | null,
  next: { pageKey: string; title: string; iconKey?: string; locationHref: string },
): boolean {
  return (
    current?.location.href === next.locationHref &&
    current.key === next.pageKey &&
    current.title === next.title &&
    current.iconKey === next.iconKey
  )
}
