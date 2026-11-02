import { faPlus } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Profiler } from 'react'

import { FULL_BLEED_PAGE_KEYS } from '../../app/workspaceTabState'
import { Toolbar } from '../../components/Toolbar'
import { Button } from '../../components/ui/button'
import { reportShellRender } from '../../lib/tabSwitchLog'

import { CORNER_TITLEBAR_CLASS, CornerSidebarToggle } from './CornerSidebarToggle'
import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceController } from './useWorkspaceController'

/** The header above a page tab; full-bleed pages go without one unless they fill the window's corner. */
export function WorkspacePageToolbar({ ws }: { ws: WorkspaceController }) {
  const {
    mainPageOpen,
    activeTab,
    activeExternalLink,
    toolbarPageUrl,
    scope,
    filter,
    count,
    viewLoading,
    namespaces,
    switching,
    loadNamespaces,
    setClusterNamespace,
    onRefresh,
    toolbarSegments,
    showListControls,
    setActiveFilter,
    toolbarPrimaryAction,
    setToolbarLeftEl,
    setToolbarRightEl,
    setToolbarHeaderRightEl,
    toolbarHeaderRightOccupied,
    toolbarHasControls,
  } = ws
  const cornerPane = useWorkspacePane()?.cornerPane ?? false
  // In the dock this page sits right of the chat; only as the main page does it own the corner.
  const corner = mainPageOpen && cornerPane

  if (!scope || (!corner && FULL_BLEED_PAGE_KEYS.has(activeTab?.active ?? ''))) return null

  return (
    <Profiler id="toolbar" onRender={(id, _p, ms) => reportShellRender(id, ms)}>
      <Toolbar
        leading={corner ? <CornerSidebarToggle /> : undefined}
        headerClassName={corner ? CORNER_TITLEBAR_CLASS : undefined}
        segments={toolbarSegments}
        filter={filter}
        onFilterChange={setActiveFilter}
        count={count}
        headerRightActions={
          <div
            ref={setToolbarHeaderRightEl}
            className="titlebar-no-drag flex min-w-0 items-center gap-1 empty:hidden"
          />
        }
        hasHeaderRightActions={toolbarHeaderRightOccupied}
        filterControls={
          // Left portal target: views push filters/tabs/pickers here via
          // useToolbarSlot('left', …). `empty:hidden` so an unused slot never
          // adds a stray flex gap next to the search box.
          <div
            ref={setToolbarLeftEl}
            className="titlebar-no-drag flex min-w-0 items-center gap-1 empty:hidden"
          />
        }
        extraActions={
          <>
            {/* Right portal target: always present so any active view can
              render its own controls (e.g. the Grafana dashboard's
              variable / time-range pickers) via useToolbarSlots().right.
              `empty:hidden` so it adds no flex gap before the CTA when a
              page uses the App-level action below instead. */}
            <div
              ref={setToolbarRightEl}
              className="titlebar-no-drag flex items-center gap-2 empty:hidden"
            />
            {toolbarPrimaryAction ? (
              <Button
                size="sm"
                type="button"
                disabled={toolbarPrimaryAction.disabled}
                onClick={toolbarPrimaryAction.onClick}
              >
                <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
                {toolbarPrimaryAction.label}
              </Button>
            ) : null}
          </>
        }
        onRefresh={onRefresh}
        hasControls={toolbarHasControls}
        showFilter={showListControls}
        namespaces={showListControls && scope.kind === 'cluster' ? namespaces : undefined}
        namespacesLoading={activeTab?.namespacesState === 'loading'}
        namespacesTruncated={activeTab?.namespacesTruncated}
        namespacesTotal={activeTab?.namespacesTotal}
        onLoadNamespaces={showListControls && scope.kind === 'cluster' ? loadNamespaces : undefined}
        selectedNamespace={
          showListControls && scope.kind === 'cluster' ? (scope.namespace ?? '') : undefined
        }
        onSelectNamespace={
          showListControls && scope.kind === 'cluster' ? setClusterNamespace : undefined
        }
        switching={switching}
        loading={viewLoading}
        currentPageUrl={toolbarPageUrl}
        externalLink={activeExternalLink}
      />
    </Profiler>
  )
}
