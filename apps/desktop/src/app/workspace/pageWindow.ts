import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { agentArtifactUrl } from '../../components/agent/sessionUrl'
import {
  ARTIFACT_PAGE,
  readArtifactLine,
  readPickedArtifactVersion,
} from '../../lib/sessionArtifacts'
import { toAbsoluteAtlasUrl } from '../../lib/webBaseUrl'
import { pageLocationForTab } from '../workspaceTabFactory'

import type { WorkspaceTabState } from '../workspaceTabState'

/**
 * The link a new window opens to show a dock tab. An artifact needs its chat,
 * so it goes by the link Share gives out. Null for a page only this window
 * holds: a file preview, or an artifact whose card has not loaded.
 */
export function pageWindowUrl(tab: WorkspaceTabState, sessionId: string | null): string | null {
  if (tab.active !== ARTIFACT_PAGE) return toAbsoluteAtlasUrl(pageLocationForTab(tab).href)
  const latest = readArtifactLine(sessionId, tab.filter)?.at(-1)

  if (!sessionId || !latest) return null

  return agentArtifactUrl(
    tab.scope.teamId,
    sessionId,
    tab.filter,
    readPickedArtifactVersion(sessionId, tab.filter) ?? latest.version,
  )
}

/**
 * A window opened for one page opens that page and shows it expanded, once its
 * tab is in the dock: an artifact's tab waits for its chat to load.
 */
export function usePageWindow(
  open: (url: string) => void,
  dockOpen: boolean,
  setDockExpanded: (expanded: boolean) => void,
) {
  const [opened, setOpened] = useState(false)
  const expanded = useRef(false)

  useEffect(() => {
    void api.takeWindowPage().then((url) => {
      if (!url) return
      open(url)
      setOpened(true)
    })
  }, [open])

  useEffect(() => {
    if (!opened || !dockOpen || expanded.current) return
    expanded.current = true
    setDockExpanded(true)
  }, [opened, dockOpen, setDockExpanded])
}
