import { Terminal } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../api'
import { PageMeta } from '../app/pageMeta'
import { Button } from '../components/ui/button'
import { toast } from '../components/ui/toast'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'

import { LocalTerminalView } from './LocalTerminalView'

import type { TerminalTarget } from '../api/local-terminal-types'

export function TerminalView({ teamId }: { teamId: string }) {
  const { tabId, conversationId } = useWorkspaceTab()
  const [target, setTarget] = useState<TerminalTarget | 'local' | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let disposed = false

    void api
      .localTerminalDescribe(tabId)
      .then((value) => {
        if (!disposed) {
          setTarget(value)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!disposed) {
          toast.apiError('Could not load terminal state', err)
          setLoading(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [tabId])

  if (target) return <LocalTerminalView target={target === 'local' ? undefined : target} />

  return (
    <PageMeta pageKey="team.terminal" title="Terminal" icon={<Terminal className="h-3.5 w-3.5" />}>
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-secondary">Open a terminal</p>
        <Button
          type="button"
          disabled={loading}
          onClick={() => setTarget('local')}
          variant="secondary"
        >
          This computer
        </Button>
        <Button
          type="button"
          disabled={loading || !conversationId}
          onClick={() => {
            if (conversationId) setTarget({ teamId, sessionId: conversationId })
          }}
          variant="secondary"
        >
          Current conversation runtime
        </Button>
        {!conversationId && (
          <p className="text-xs text-tertiary">
            Select a conversation to open its runtime terminal.
          </p>
        )}
      </div>
    </PageMeta>
  )
}
