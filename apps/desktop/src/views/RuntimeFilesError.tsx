import { FileQuestion, RefreshCw } from 'lucide-react'

import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/ui/button'
import { t } from '../i18n'

/** A preview failure belongs to its file and source, not to unrelated chats. */
export function RuntimeFilesError({
  error,
  errorCode,
  filePath,
  source,
  onRetry,
  onOpenConversation,
}: {
  error: string
  errorCode?: string
  filePath: string
  source: { conversationTitle?: string; label: string; sessionId: string } | null
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
                'Ask the agent in the source conversation to share a copy from its workspace, then open the new link.',
              )}
            </p>
          )}
          <p className="mt-2 break-all">{filePath}</p>
          {source && (
            <div className="mt-2">
              <p>{source.conversationTitle}</p>
              <p>{source.label}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenConversation(source.sessionId)}
              >
                {t('Open conversation')}
              </Button>
            </div>
          )}
        </>
      }
      primaryAction={{ label: t('Retry'), icon: RefreshCw, onClick: onRetry }}
    />
  )
}
