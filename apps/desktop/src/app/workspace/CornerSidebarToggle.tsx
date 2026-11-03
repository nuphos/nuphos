import { SidebarToggleButton } from '../../components/Sidebar'

import { useWorkspacePane } from './WorkspacePaneContext'

/**
 * Class for the header that fills the window's top-left corner once the sidebar
 * is collapsed: it clears the macOS traffic lights (see index.css).
 */
export const CORNER_TITLEBAR_CLASS = 'workspace-corner-titlebar'

/** The sidebar's own toggle, shown at the start of whichever header took over its corner. */
export function CornerSidebarToggle() {
  const pane = useWorkspacePane()

  if (!pane?.cornerPane) return null

  return (
    <SidebarToggleButton
      collapsed
      onClick={pane.toggleSidebarCollapsed}
      className="mr-1 flex-shrink-0"
    />
  )
}
