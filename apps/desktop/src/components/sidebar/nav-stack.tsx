import clsx from 'clsx'
import { ChevronLeft, PanelLeft } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Kbd } from '../ui/kbd'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/menu'
import { Tooltip } from '../ui/tooltip'

import type { BreadcrumbSegment } from '../Toolbar'
import type { CSSProperties, ReactNode } from 'react'

const NAV_TRANSITION_MS = 280

/**
 * Keeps the sidebar's section list rendered live while sliding the previous
 * list out whenever `viewKey` changes. Direction comes from `level`: a deeper
 * level slides the new list in from the right (old exits left); a shallower
 * level reverses; same level cross-fades.
 *
 * The entering layer re-mounts on every navigation (its `key` is `viewKey`),
 * which is what replays its keyframe animation — CSS transitions get coalesced
 * away on a node that already existed, but a fresh mount always animates. The
 * outgoing layer is a frozen snapshot of the just-displayed list. Honours
 * prefers-reduced-motion via the `.t-nav-stack` CSS (animations disabled).
 */
export function SidebarNavStack({
  viewKey,
  level,
  children,
}: {
  viewKey: string
  level: number
  children: ReactNode
}) {
  // Track the previous view via state (not a ref) so the slide direction can be
  // derived during render — the documented "store info from previous renders"
  // pattern — without reading refs while rendering.
  const [tracker, setTracker] = useState({
    key: viewKey,
    level,
    dir: 0,
    navigated: false,
  })

  if (viewKey !== tracker.key) {
    const dir = level === tracker.level ? 0 : level > tracker.level ? 1 : -1

    setTracker({ key: viewKey, level, dir, navigated: true })
  }
  const navDir =
    viewKey === tracker.key
      ? tracker.dir
      : level === tracker.level
        ? 0
        : level > tracker.level
          ? 1
          : -1
  // Skip the enter animation on first paint (load/HMR) — only animate once a
  // real navigation has happened, so the sidebar doesn't fade in on every boot.
  const animate = tracker.navigated || viewKey !== tracker.key

  const [outgoing, setOutgoing] = useState<{
    node: ReactNode
    dir: number
    key: string
  } | null>(null)
  const prevKey = useRef(viewKey)
  const lastChildren = useRef<ReactNode>(children)
  const cleanupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Snapshot the live children after every commit so the next navigation can
  // freeze the just-displayed list (read only inside the layout effect).
  useEffect(() => {
    lastChildren.current = children
  })

  useLayoutEffect(() => {
    if (viewKey === prevKey.current) return
    setOutgoing({ node: lastChildren.current, dir: navDir, key: prevKey.current })
    prevKey.current = viewKey
    if (cleanupTimer.current) clearTimeout(cleanupTimer.current)
    cleanupTimer.current = setTimeout(() => {
      setOutgoing(null)
      cleanupTimer.current = null
    }, NAV_TRANSITION_MS)
  }, [viewKey, navDir])

  useEffect(
    () => () => {
      if (cleanupTimer.current) clearTimeout(cleanupTimer.current)
    },
    [],
  )

  return (
    <div className="t-nav-stack">
      <div
        key={viewKey}
        className="t-nav-stack__layer"
        data-role="in"
        data-anim={animate ? 'enter' : undefined}
        style={{ '--nav-dir': navDir } as CSSProperties}
      >
        {children}
      </div>
      {outgoing && (
        <div
          key={outgoing.key}
          className="t-nav-stack__layer"
          data-role="out"
          data-anim="exit"
          style={{ '--nav-dir': outgoing.dir } as CSSProperties}
          aria-hidden
        >
          {outgoing.node}
        </div>
      )}
    </div>
  )
}

const BACK_HOVER_DELAY_MS = 600
const BACK_TREE_INDENT = 18 // px each hierarchy level shifts right (icon + label together).

/**
 * The sidebar's "← Back" control. A click (or Enter) goes up one level.
 * Hovering for {@link BACK_HOVER_DELAY_MS} opens the shared dropdown showing the
 * full page hierarchy (the breadcrumb path) as a tree with the current page
 * marked, letting you jump to any ancestor. The menu is portaled, so it never
 * affects the sidebar's layout/scroll.
 */
export function SidebarBackControl({
  onBack,
  hierarchy = [],
}: {
  onBack: () => void
  hierarchy?: BreadcrumbSegment[]
}) {
  const [open, setOpen] = useState(false)
  // Keep only page/list segments — drop resource instances (team switcher,
  // accounts, clusters, pods, …) so the tree reflects the page path, e.g.
  // Home → EKS → Pods, not Home → aws-prod → EKS → my-cluster → Pods → sb-…
  const nodes = hierarchy.filter((segment) => !segment.isResource)

  return (
    <Menu
      modal={false}
      open={open}
      onOpenChange={(next, details) => {
        // A press on the trigger is the "go back" action, not "open the tree" —
        // regardless of whether the hover menu is already open.
        if (details.reason === 'trigger-press') {
          setOpen(false)
          onBack()

          return
        }
        setOpen(next)
      }}
    >
      <MenuTrigger
        openOnHover
        delay={BACK_HOVER_DELAY_MS}
        className={(state) =>
          clsx(
            'group mb-3 flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-[13.5px] outline-none transition-colors',
            state.open
              ? 'bg-[var(--sidebar-overlay-active)] text-main'
              : 'text-secondary hover:bg-[var(--sidebar-overlay-hover)] hover:text-main focus-visible:bg-[var(--sidebar-overlay-focus)]',
          )
        }
      >
        <ChevronLeft className="h-3.5 w-3.5 flex-shrink-0 -translate-x-0.5 transition-transform group-hover:-translate-x-1" />
        <span className="flex-1 truncate text-left">Back</span>
      </MenuTrigger>
      {nodes.length > 0 && (
        <MenuContent side="bottom" align="start" className="w-[260px]">
          {nodes.map((node, i) => {
            const isCurrent = i === nodes.length - 1
            // Switcher segments (account/project pickers) carry no `onClick` —
            // their navigation lives on the selected option. Fall back to it so
            // every ancestor in the tree is jumpable, not just `onClick` ones.
            const navigate = node.onClick ?? node.options?.find((o) => o.selected)?.onPick
            const clickable = !isCurrent && !!navigate
            const row = (
              <span
                className="relative flex min-w-0 items-center gap-1.5"
                style={{ paddingLeft: i * BACK_TREE_INDENT }}
              >
                {/* Tree elbow: a short L-line from under the parent's icon down
                    to this row's icon, mirroring the Figma hierarchy design. */}
                {i > 0 && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute rounded-bl-[6px] border-b border-l border-zGray-700"
                    style={{
                      left: (i - 1) * BACK_TREE_INDENT + 9,
                      width: BACK_TREE_INDENT - 9,
                      top: -8,
                      bottom: '50%',
                    }}
                  />
                )}
                {node.icon && (
                  <span className="flex flex-shrink-0 items-center [&>*]:!h-4 [&>*]:!w-4 [&>svg]:!h-4 [&>svg]:!w-4">
                    {node.icon}
                  </span>
                )}
                <span className="truncate">{node.label}</span>
                {isCurrent && <span className="flex-shrink-0 text-tertiary">(current)</span>}
              </span>
            )

            if (clickable) {
              return (
                <MenuItem key={i} onClick={() => navigate?.()}>
                  {row}
                </MenuItem>
              )
            }

            return (
              <div
                key={i}
                className={clsx(
                  'flex min-h-8 items-center rounded-md px-2.5 py-1.5 text-[13px]',
                  isCurrent ? 'font-medium text-main' : 'text-tertiary',
                )}
              >
                {row}
              </div>
            )
          })}
        </MenuContent>
      )}
    </Menu>
  )
}

/**
 * Collapse/expand toggle that lives just right of the macOS traffic lights.
 * Shared by the sidebar titlebar (expanded) and the tab strip (collapsed) so
 * the control keeps the same look and screen position across both states.
 */
export function SidebarToggleButton({
  collapsed,
  onClick,
  className,
}: {
  collapsed: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <Tooltip
      content={
        <span className="inline-flex items-center gap-1.5">
          {collapsed ? 'Show sidebar' : 'Hide sidebar'} <Kbd combo="mod+b" />
        </span>
      }
    >
      <button
        type="button"
        onClick={onClick}
        className={clsx(
          'titlebar-no-drag w-8 h-8 rounded-md flex items-center justify-center text-tertiary transition-colors hover:text-secondary hover:bg-[var(--sidebar-overlay-hover)]',
          className,
        )}
        aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
        aria-pressed={!collapsed}
      >
        <PanelLeft className="w-[15px] h-[15px]" strokeWidth={1.5} />
      </button>
    </Tooltip>
  )
}
