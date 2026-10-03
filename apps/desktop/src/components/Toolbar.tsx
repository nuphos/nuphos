import clsx from 'clsx'
import { Check, Copy, Loader2, PanelRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Breadcrumb } from './toolbar-breadcrumb'
import { NamespaceCombobox, RefreshButton } from './toolbar-controls'
import { ExternalPageLinkButton } from './toolbar-external-link'
import { SearchBox } from './toolbar-search'

import type { BreadcrumbSegment } from './toolbar-types'
import type { ExternalPageLink } from '../lib/externalPageLink'
import type { ReactNode } from 'react'

export { SearchBox } from './toolbar-search'
export type { BreadcrumbOption, BreadcrumbSegment } from './toolbar-types'

type Props = {
  segments: BreadcrumbSegment[]
  filter: string
  onFilterChange: (s: string) => void
  count: number
  filterControls?: ReactNode
  extraActions?: ReactNode
  headerRightActions?: ReactNode
  hasHeaderRightActions?: boolean
  // Whether the controls row has anything worth showing. `filterControls` /
  // `extraActions` can't drive this: they always carry the (usually empty)
  // portal-slot mounts, so the caller computes real content presence instead.
  hasControls?: boolean
  showFilter?: boolean
  onRefresh: () => void
  namespaces?: string[]
  namespacesLoading?: boolean
  /** True when the cluster holds more namespaces than the fetched page. */
  namespacesTruncated?: boolean
  /** The cluster's real namespace count, when the server reports one. */
  namespacesTotal?: number | null
  /** Fetches the namespace list; called the first time the picker is opened. */
  onLoadNamespaces?: () => void
  selectedNamespace?: string
  onSelectNamespace?: (ns: string) => void
  switching?: boolean
  loading?: boolean
  currentPageUrl?: string
  externalLink?: ExternalPageLink | null
  /**
   * The workspace's agent chat dock. It rides the toolbar rather than the tab
   * strip because the strip has no stable trailing edge: tabs grow into it, and
   * on Windows and Linux the native caption buttons own that corner (see
   * `.titlebar-caption-pad`). Passing a handler keeps the header row alive even
   * on a page with no breadcrumb of its own — otherwise the dock would have no
   * entry point there at all.
   */
  agentSidebarOpen?: boolean
  onToggleAgentSidebar?: () => void
}

export function Toolbar({
  segments,
  filter,
  onFilterChange,
  count,
  filterControls,
  extraActions,
  headerRightActions,
  hasHeaderRightActions = false,
  hasControls = false,
  showFilter = true,
  onRefresh,
  namespaces,
  namespacesLoading,
  namespacesTruncated,
  namespacesTotal,
  onLoadNamespaces,
  selectedNamespace,
  onSelectNamespace,
  switching,
  loading,
  currentPageUrl,
  externalLink,
  agentSidebarOpen,
  onToggleAgentSidebar,
}: Props) {
  const [copiedPageUrl, setCopiedPageUrl] = useState(false)
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current)
    }
  }, [])

  async function copyCurrentPageUrl() {
    if (!currentPageUrl) return
    try {
      await navigator.clipboard.writeText(currentPageUrl)
      setCopiedPageUrl(true)
      if (copyResetRef.current) clearTimeout(copyResetRef.current)
      copyResetRef.current = setTimeout(() => setCopiedPageUrl(false), 1200)
    } catch {
      setCopiedPageUrl(false)
    }
  }

  const showNs = !!namespaces && !!onSelectNamespace && !!onLoadNamespaces
  const showControlsRow = showNs || showFilter || hasControls
  const showHeaderRow = segments.length > 0 || !!onToggleAgentSidebar

  if (!showHeaderRow && !showControlsRow) return null

  return (
    <div
      className={clsx(
        'titlebar-drag flex flex-col border-b border-zGray-800/60 bg-main',
        showHeaderRow && showControlsRow ? 'h-[84px]' : 'h-[42px]',
      )}
    >
      {showHeaderRow && (
        // The inner border separates this row from the controls row below it.
        // Without a controls row it would stack on the wrapper's own border-b
        // and read as one 2px-thick divider, so it only draws when needed.
        <div
          className={clsx(
            'h-[42px] flex items-center px-3 gap-1',
            showControlsRow && 'border-b border-zGray-800/60',
          )}
        >
          <Breadcrumb segments={segments} />

          <div className="flex-1 titlebar-drag" />
          {switching && <Loader2 className="w-3.5 h-3.5 mx-1 text-zViolet-accent animate-spin" />}
          {/* flex-shrink-0: an uncapped trailing crumb shrinks the drag spacer
              to nothing before it truncates, and these must not be next. */}
          <div className="titlebar-no-drag flex flex-shrink-0 items-center gap-1">
            {hasHeaderRightActions ? (
              headerRightActions
            ) : (
              <RefreshButton onRefresh={onRefresh} loading={loading} />
            )}
            <button
              onClick={() => void copyCurrentPageUrl()}
              disabled={!currentPageUrl}
              className="w-7 h-7 rounded-md hover:bg-zGray-800/60 disabled:hover:bg-transparent text-secondary hover:text-main disabled:text-tertiary disabled:opacity-50 flex items-center justify-center"
              title={copiedPageUrl ? 'Copied' : 'Copy page URL'}
              aria-label={copiedPageUrl ? 'Copied page URL' : 'Copy page URL'}
            >
              {copiedPageUrl ? (
                <Check className="w-3.5 h-3.5 text-zViolet-accent" strokeWidth={2} />
              ) : (
                <Copy className="w-3.5 h-3.5" strokeWidth={2} />
              )}
            </button>
            {externalLink && <ExternalPageLinkButton link={externalLink} />}
            {onToggleAgentSidebar && (
              <button
                onClick={onToggleAgentSidebar}
                className={clsx(
                  'w-7 h-7 rounded-md flex items-center justify-center transition-colors',
                  agentSidebarOpen
                    ? 'bg-zGray-800/60 text-main'
                    : 'text-secondary hover:text-main hover:bg-zGray-800/60',
                )}
                title={agentSidebarOpen ? 'Close agent chat' : 'Open agent chat'}
                aria-label={agentSidebarOpen ? 'Close agent chat' : 'Open agent chat'}
                aria-pressed={agentSidebarOpen}
              >
                {/* The sidebar toggle beside the traffic lights, mirrored:
                    same glyph and weight, opposite edge, same job. */}
                <PanelRight className="w-[15px] h-[15px]" strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>
      )}

      {showControlsRow && (
        <div className="h-[42px] flex items-center px-3 gap-2">
          {/* Sized by its content, not `flex-1`. With `flex-1` this shared a
              basis-0 split with the drag spacer below, so it only ever got half
              the row — and since the filter controls are shrink-proof, the
              search box absorbed the whole deficit and collapsed to its icon
              the moment a page put a few chips beside it. */}
          <div className="titlebar-no-drag flex min-w-0 items-center gap-2">
            {showNs && (
              <NamespaceCombobox
                namespaces={namespaces}
                loading={namespacesLoading}
                truncated={namespacesTruncated}
                total={namespacesTotal}
                onOpen={onLoadNamespaces}
                selectedNamespace={selectedNamespace ?? ''}
                onSelectNamespace={onSelectNamespace}
              />
            )}

            {showFilter && (
              <SearchBox filter={filter} onFilterChange={onFilterChange} count={count} />
            )}
            {filterControls && (
              <div className="titlebar-no-drag flex min-w-0 items-center gap-1">
                {filterControls}
              </div>
            )}
          </div>

          <div className="flex-1 titlebar-drag" />
          {extraActions && (
            <div className="titlebar-no-drag flex items-center gap-2 flex-shrink-0">
              {extraActions}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
