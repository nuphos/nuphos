import clsx from 'clsx'

import { DetailSidebarTransition } from '../../DetailSidebarTransition'
import { JournalSidePanel } from '../JournalPanel'

import type { PanelViewCtx } from './ctx'
import type { ReactNode } from 'react'

export function PanelPageLayout({ c, content }: { c: PanelViewCtx; content: ReactNode }) {
  const {
    activeTab,
    canUseJournalPane,
    journalFocus,
    journalPaneOpen,
    locateInChat,
    setJournalPaneOpen,
    setPanelRoot,
    teamId,
    unbound,
  } = c

  return (
    <div
      ref={setPanelRoot}
      tabIndex={-1}
      className={clsx(
        'flex min-h-0 min-w-0 flex-1 outline-none agent-page-layout',
        unbound ? 'bg-main' : 'bg-agentCanvas',
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{content}</div>
      {activeTab && canUseJournalPane && journalPaneOpen && (
        <DetailSidebarTransition
          onClose={() => setJournalPaneOpen(false)}
          closeOnEscape={!activeTab.streaming}
          className="flex w-[40%] min-w-[360px] max-w-[640px] flex-shrink-0 flex-col overflow-hidden bg-agentCanvas"
        >
          {(requestClose) => (
            <JournalSidePanel
              sessionId={activeTab.sessionId}
              teamId={teamId}
              onClose={requestClose}
              onLocateInChat={locateInChat}
              focusTarget={journalFocus}
            />
          )}
        </DetailSidebarTransition>
      )}
    </div>
  )
}
