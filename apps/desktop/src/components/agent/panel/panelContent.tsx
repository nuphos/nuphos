import clsx from 'clsx'
import { Maximize2, SquarePen } from 'lucide-react'

import { ConversationSwitcher } from './ConversationSwitcher'

import type { PanelViewCtx } from './ctx'
import type { ReactNode } from 'react'

type ContentProps = {
  c: PanelViewCtx
  homePage: ReactNode
  conversationPage: ReactNode
}

export function PanelContent({ c, homePage, conversationPage }: ContentProps) {
  const {
    activeTab,
    draggingFiles,
    expandCurrentSession,
    isSidebarMode,
    onExpandToPage,
    onPanelDragEnter,
    onPanelDragLeave,
    onPanelDragOver,
    onPanelDrop,
    openConversation,
    showingConversationPage,
    startNewChat,
    teamId,
    widthVw,
  } = c

  return (
    <div
      style={isSidebarMode ? { width: `${String(widthVw)}vw` } : undefined}
      // No bottom inset here: the composer at the foot of the panel carries
      // one that matches the content card's own, and a second one stacked on
      // top of it left the two columns ending on different lines.
      className="flex flex-col h-full min-w-0"
    >
      {isSidebarMode && (
        <div className="h-[42px] flex-shrink-0 flex items-center gap-0.5 px-2.5">
          <div className="flex-1" />
          {showingConversationPage && (
            <button
              onClick={startNewChat}
              className="w-7 h-7 rounded-md hover:bg-zGray-800/60 text-secondary hover:text-main flex items-center justify-center transition-colors"
              title="New chat"
              aria-label="New chat"
            >
              <SquarePen className="w-3.5 h-3.5" strokeWidth={1.8} />
            </button>
          )}
          {onExpandToPage && (
            <button
              onClick={(event) => expandCurrentSession({ newTab: event.metaKey || event.ctrlKey })}
              className="w-7 h-7 rounded-md hover:bg-zGray-800/60 text-secondary hover:text-main flex items-center justify-center transition-colors"
              title="Open in tab"
              aria-label="Open agent chat in a tab"
            >
              <Maximize2 className="w-3.5 h-3.5" strokeWidth={1.8} />
            </button>
          )}
          {teamId && (
            <ConversationSwitcher
              teamId={teamId}
              activeSessionId={activeTab?.sessionId ?? null}
              onPick={(sessionId, titleHint) => void openConversation(sessionId, titleHint)}
            />
          )}
        </div>
      )}

      <div
        onDragEnter={onPanelDragEnter}
        onDragOver={onPanelDragOver}
        onDragLeave={onPanelDragLeave}
        onDrop={onPanelDrop}
        className="t-page-slide relative flex-1 min-h-0"
        data-page={showingConversationPage ? '2' : '1'}
      >
        <section className="t-page flex flex-col min-h-0" data-page-id="1">
          {homePage}
        </section>
        <section className="t-page flex flex-col min-h-0" data-page-id="2">
          {conversationPage}
        </section>
        {draggingFiles && (
          // Whole-panel drop affordance — a light, transparent tint
          // with a small pill, Codex-style. pointer-events-none so drag/drop keeps
          // firing on the container underneath.
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[inherit] bg-zViolet-500/[0.06] ring-1 ring-inset ring-zViolet-accent/30">
            <span className="rounded-full border border-zViolet-accent/30 bg-elevated/90 px-3 py-1 text-[12px] font-medium text-zViolet-accent shadow-sm backdrop-blur-sm">
              Drop to attach
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export function PanelSidebarLayout({ c, content }: { c: PanelViewCtx; content: ReactNode }) {
  const { dragging, open, setDragging, setPanelRoot, widthVw } = c

  return (
    <aside
      ref={setPanelRoot}
      tabIndex={-1}
      style={{ width: open ? `${String(widthVw)}vw` : 0 }}
      className={clsx(
        // Match the app chrome (same surface as the left sidebar) instead of
        // the content-card background, which reads as a white panel in light
        // mode.
        'flex-shrink-0 flex flex-col sidebar-surface relative outline-none',
        // Closing collapses the panel to width 0 but keeps `content` mounted, so
        // the chat survives a toggle. Overflow has to be clipped while it is
        // closed or that content spills out of the zero-width box and paints
        // over whatever sits beside it — visibly so against the first-run
        // panel, which shares this dock slot and whose surface is translucent.
        // Open, it stays visible: popovers anchored inside need to escape.
        open ? 'overflow-visible' : 'overflow-hidden',
        // Expand/collapse decelerates: starts fast, eases out at the end.
        !dragging && 'transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
      )}
    >
      {open && (
        <div
          onMouseDown={() => setDragging(true)}
          // Inside the panel, not hanging off it: the lane it needs is already
          // there in the panel's own inset, and taking it from the content card
          // instead made the gutter between the two columns nearly twice the
          // one on the left of the window.
          className="group absolute left-0 top-0 bottom-0 z-10 w-2 cursor-col-resize"
        >
          <div
            className={clsx(
              'h-full w-1 transition-colors',
              dragging ? 'bg-zViolet-500/30' : 'group-hover:bg-zGray-800/60',
            )}
          />
        </div>
      )}
      {content}
    </aside>
  )
}
