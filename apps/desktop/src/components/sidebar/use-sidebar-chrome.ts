import { useCallback, useEffect, useRef, useState } from 'react'

import {
  DEFAULT_COLLAPSED_GROUPS,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_KEY,
  loadGroupState,
  writeGroupState,
} from './state'

import type { GroupState } from './state'
import type { Section } from './types'
import type { UIEvent } from 'react'

export function useSidebarChrome({ teamId, collapsed }: { teamId: string; collapsed: boolean }) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH
    const v = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))

    if (!v || Number.isNaN(v)) return DEFAULT_SIDEBAR_WIDTH

    return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, v))
  })
  const [dragging, setDragging] = useState(false)
  // When collapsed, hovering the window's left edge slides the sidebar out as a
  // floating overlay. `peek` tracks that hover; reset whenever collapse toggles
  // so a fresh collapsed state always starts hidden.
  const [peek, setPeek] = useState(false)
  const [peekCollapsed, setPeekCollapsed] = useState(collapsed)

  if (collapsed !== peekCollapsed) {
    setPeekCollapsed(collapsed)
    setPeek(false)
  }
  const [groupState, setGroupState] = useState<GroupState>(() => {
    if (typeof window === 'undefined') return {}

    return loadGroupState(teamId)
  })
  // Ephemeral expansion of the always-folded integration groups: lives only
  // in memory and resets on team switch, so those groups are folded at rest.
  const [openedIntegrationGroups, setOpenedIntegrationGroups] = useState<Set<string>>(
    () => new Set(),
  )
  // Re-seed team-scoped state on team switch during render — the documented
  // "storing information from previous renders" pattern (cf. SidebarNavStack).
  const [seededTeamId, setSeededTeamId] = useState(teamId)

  if (seededTeamId !== teamId) {
    setSeededTeamId(teamId)
    setGroupState(loadGroupState(teamId))
    setOpenedIntegrationGroups(new Set())
  }
  const isGroupCollapsed = useCallback(
    (section: Pick<Section, 'title' | 'defaultCollapsed'>) => {
      // The title-less top nav is the app itself; there is nothing to fold it
      // into and no header to fold it from.
      if (!section.title) return false
      const title = section.title

      return DEFAULT_COLLAPSED_GROUPS.has(title)
        ? !openedIntegrationGroups.has(title)
        : (groupState[title] ?? (section.defaultCollapsed ? 'closed' : 'open')) === 'closed'
    },
    [groupState, openedIntegrationGroups],
  )

  useEffect(() => {
    if (!dragging) return
    function move(e: MouseEvent) {
      setWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX)))
    }
    function up() {
      setDragging(false)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)

    return () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
  }, [dragging])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width))
  }, [width])

  useEffect(() => {
    writeGroupState(teamId, groupState)
  }, [groupState, teamId])

  const toggleGroup = useCallback(
    (section: Pick<Section, 'title' | 'defaultCollapsed'>) => {
      // Only a titled section has a header to toggle from.
      const title = section.title

      if (!title) return
      if (DEFAULT_COLLAPSED_GROUPS.has(title)) {
        setOpenedIntegrationGroups((prev) => {
          const next = new Set(prev)

          if (next.has(title)) next.delete(title)
          else next.add(title)

          return next
        })

        return
      }
      setGroupState((prev) => ({
        ...prev,
        [title]: isGroupCollapsed(section) ? 'open' : 'closed',
      }))
    },
    [isGroupCollapsed],
  )

  // Overlay scrollbar: the nav thumb is hidden by default (see `.scrollbar-overlay`
  // in index.css) and revealed on hover. Flag active scrolling with a
  // `data-scrolling` attribute so the thumb also shows while the wheel/trackpad
  // moves even when the pointer isn't over the sidebar, then fades out shortly
  // after scrolling stops. We mutate the DOM node directly to avoid re-rendering
  // the whole nav on every scroll event.
  const navScrollHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleNavScroll = useCallback((e: UIEvent<HTMLElement>) => {
    const el = e.currentTarget

    el.setAttribute('data-scrolling', 'true')
    if (navScrollHideTimer.current) clearTimeout(navScrollHideTimer.current)
    navScrollHideTimer.current = setTimeout(() => {
      el.removeAttribute('data-scrolling')
    }, 900)
  }, [])

  useEffect(
    () => () => {
      if (navScrollHideTimer.current) clearTimeout(navScrollHideTimer.current)
    },
    [],
  )

  return {
    width,
    dragging,
    setDragging,
    peek,
    setPeek,
    isGroupCollapsed,
    toggleGroup,
    handleNavScroll,
  }
}
