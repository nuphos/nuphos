import { FileQuestion, RefreshCw } from 'lucide-react'

import { SessionLinkLabel } from '../components/agent/SessionLinkLabel'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/ui/button'
import { t } from '../i18n'

/** A preview failure belongs to its file and source, not to unrelated chats. */
export function RuntimeFilesError({
  teamId,
  error,
  errorCode,
  filePath,
  source,
  onRetry,
  onOpenConversation,
}: {
  teamId: string
  error: string
  errorCode?: string
  filePath: string
  source: { label: string; sessionId: string } | null
  onRetry: () => void
  onOpenConversation: (sessionId: string) => void
}) {
  return (
    <EmptyState
      icon={FileQuestion}
      title={t('Could not load runtime files')}
      description={
        <>
          <p>{error}</p>
          {errorCode === 'forbidden_path' && (
            <p className="mt-2">
              {t(
                'Ask the source conversation to share a copy from its workspace, then open the new link.',
              )}
            </p>
          )}
          <p className="mt-2 break-all">{filePath}</p>
          {source && (
            <div className="mt-2">
              <p>{source.label}</p>
              <Button
                variant="ghost"
                size="sm"
                className="max-w-full"
                onClick={() => onOpenConversation(source.sessionId)}
              >
                <SessionLinkLabel teamId={teamId} sessionId={source.sessionId} />
              </Button>
            </div>
          )}
        </>
      }
      primaryAction={{ label: t('Retry'), icon: RefreshCw, onClick: onRetry }}
    />
  )
}
