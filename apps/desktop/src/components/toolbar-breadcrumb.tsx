import clsx from 'clsx'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

import { renderGroupedOptions } from './toolbar-options'
import { Menu, MenuContent, MenuTrigger } from './ui/menu'

import type { BreadcrumbSegment } from './toolbar-types'
import type { ReactNode } from 'react'

/**
 * Where the crumb itself leads. A crumb that offers a picker names one of the
 * options in it — the selected one — so going "to this crumb" is picking that
 * option again: from a Secret, the cluster crumb re-enters the cluster. An
 * explicit `onClick` wins, since a crumb that has one is a drill-down offering
 * its way back out.
 */
function crumbTarget(seg: BreadcrumbSegment): (() => void) | undefined {
  return seg.onClick ?? seg.options?.find((option) => option.selected)?.onPick
}

export function Breadcrumb({ segments }: { segments: BreadcrumbSegment[] }) {
  return (
    <div className="titlebar-no-drag flex max-w-full min-w-0 items-center overflow-hidden">
      {segments.map((seg, i) => {
        // A segment with onExpand stays openable even while its options are
        // empty (initial load failed or hasn't run): opening the menu is what
        // triggers the (re)fetch, so gating on length > 0 would dead-end the
        // retry path.
        const hasMenu = !!seg.options && (seg.options.length > 0 || !!seg.onExpand)
        const go = crumbTarget(seg)
        // The trailing crumb names the page you are on, so it gets whatever
        // room the toolbar has left and truncates only once it genuinely runs
        // out. The ones before it stay capped — a long middle crumb must not
        // push the trail off the end.
        const widthClass =
          i === segments.length - 1 ? 'min-w-0 max-w-[240px]' : 'min-w-0 max-w-[180px]'

        return (
          <div key={i} className="flex items-center min-w-0">
            {i > 0 && <ChevronRight className="w-3 h-3 text-tertiary mx-0.5 flex-shrink-0" />}
            {hasMenu ? (
              <SplitCrumb seg={seg} go={go} widthClass={widthClass} />
            ) : (
              <PlainCrumb seg={seg} go={go} widthClass={widthClass} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Icon (or its loading stand-in) and label, shared by both crumb shapes. */
function CrumbFace({ seg }: { seg: BreadcrumbSegment }): ReactNode {
  return (
    <>
      {seg.loading ? (
        <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin text-zViolet-accent" />
      ) : (
        seg.icon && (
          // Shrink-proofed here rather than at each call site: the label beside
          // it truncates inside a max-width, so an icon that can flex gets
          // squeezed narrower the longer the label is — and every caller would
          // have to remember.
          <span className="flex flex-shrink-0 items-center">{seg.icon}</span>
        )
      )}
      <span className="truncate" title={seg.label}>
        {seg.label}
      </span>
    </>
  )
}

function PlainCrumb({
  seg,
  go,
  widthClass,
}: {
  seg: BreadcrumbSegment
  go?: () => void
  widthClass: string
}) {
  return (
    <button
      onPointerDown={(event) => {
        // Navigate on press, like the tab strip (#637).
        if (event.button !== 0) return
        go?.()
      }}
      onClick={(event) => {
        // Keyboard only — pointer presses already fired at pointerdown.
        if (event.detail !== 0) return
        go?.()
      }}
      disabled={!go}
      className={clsx(
        'h-7 px-2 rounded-md flex items-center gap-1.5 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-zGray-700',
        widthClass,
        go ? 'hover:bg-zGray-800/60 text-main' : 'text-secondary cursor-default',
      )}
    >
      <CrumbFace seg={seg} />
    </button>
  )
}

/**
 * A crumb that both names a place and offers its siblings: one target for the
 * label, another for the chevron.
 *
 * Hovering anywhere lights the whole crumb — going to the place it names is
 * the primary action, so the crumb as a whole is the button. The chevron then
 * deepens under the cursor: same tint at full strength, which reads as "more"
 * in either theme, where a step along the grey scale would not.
 */
function SplitCrumb({
  seg,
  go,
  widthClass,
}: {
  seg: BreadcrumbSegment
  go?: () => void
  widthClass: string
}) {
  return (
    <Menu
      onOpenChange={(open) => {
        if (open) seg.onExpand?.()
      }}
    >
      <div
        className={clsx(
          'flex h-7 items-center rounded-md',
          widthClass,
          go && 'hover:bg-zGray-800/60',
        )}
      >
        <button
          onPointerDown={(event) => {
            if (event.button !== 0) return
            go?.()
          }}
          onClick={(event) => {
            if (event.detail !== 0) return
            go?.()
          }}
          disabled={!go}
          title={go ? `Go to ${seg.label}` : undefined}
          className={clsx(
            // No hover fill of its own: the wrapper carries it, and a second
            // one at the same tint would darken this half on the way past.
            // The chevron half fills with its own deeper tint on hover, and
            // that fill starts where this padding ends — too little and the
            // label reads as touching it.
            'h-7 min-w-0 rounded-l-md pl-2 pr-1.5 flex items-center gap-1.5 text-[13px] text-main outline-none focus-visible:ring-1 focus-visible:ring-zGray-700',
            !go && 'cursor-default',
          )}
        >
          <CrumbFace seg={seg} />
        </button>
        {!seg.loading && (
          <MenuTrigger
            title={`Switch ${seg.label}`}
            aria-label={`Switch ${seg.label}`}
            className={clsx(
              // Even padding either side of the glyph: this half fills with its
              // own deeper tint on hover, and an off-centre arrow inside that
              // block is what you notice. Matches the label's leading inset, so
              // the crumb is evenly inset at both ends too.
              'h-7 flex-shrink-0 rounded-r-md px-2 flex items-center text-main outline-none',
              'hover:bg-zGray-800 data-[popup-open]:bg-zGray-800',
              'focus-visible:ring-1 focus-visible:ring-zGray-700',
            )}
          >
            <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-60" />
          </MenuTrigger>
        )}
      </div>
      <MenuContent side="bottom" align="start" className="titlebar-no-drag w-[320px] max-h-[420px]">
        {seg.options!.length > 0 ? (
          renderGroupedOptions(seg.options!)
        ) : (
          <div className="px-3 py-2 text-[12px] text-tertiary">{seg.emptyText ?? 'No items'}</div>
        )}
      </MenuContent>
    </Menu>
  )
}
