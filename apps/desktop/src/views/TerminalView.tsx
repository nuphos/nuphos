import { Terminal } from 'lucide-react'

import { PageMeta } from '../app/pageMeta'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'

import { LocalTerminalView } from './LocalTerminalView'

/** The tab filter that picks the conversation runtime over this computer. It
 *  lives in the route (`/terminal/runtime`), so a remounted view reattaches to
 *  the same kind of shell without asking. */
export const RUNTIME_TERMINAL_FILTER = 'runtime'

export function TerminalView({ teamId, filter }: { teamId: string; filter: string }) {
  const { conversationId } = useWorkspaceTab()

  if (filter !== RUNTIME_TERMINAL_FILTER) return <LocalTerminalView />
  if (conversationId) return <LocalTerminalView runtime={{ teamId, sessionId: conversationId }} />

  return (
    <PageMeta pageKey="team.terminal" title="Terminal" icon={<Terminal className="h-3.5 w-3.5" />}>
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-xs text-tertiary">Select a conversation to open its runtime terminal.</p>
      </div>
    </PageMeta>
  )
}
