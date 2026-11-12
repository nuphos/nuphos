import { ConfirmDialog } from '../../components/ConfirmDialog'
import { t } from '../../i18n'

import type { AgentTrigger } from '../../api'

export function TriggerRemoveWithoutCleanupDialog({
  open,
  loaded,
  onClose,
  onConfirm,
}: {
  open: boolean
  loaded: AgentTrigger | null
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const name = loaded?.name ?? ''
  const resources = (loaded?.managedProviderResources?.resources ?? []).filter(
    (resource) => resource.cleanupAction !== 'preserve',
  )

  return (
    <ConfirmDialog
      open={open}
      title={t('Remove without provider cleanup')}
      description={
        <span className="block">
          <span className="block">
            {t(
              '“{name}” will be removed. Providers Nuphos can still reach are cleaned up as usual. Resources in a provider whose integration is disconnected stay there and must be deleted by hand.',
              { name },
            )}
          </span>
          <span className="mt-3 block">
            {resources.length > 0
              ? t(
                  'Nuphos recorded these resources. Older Watches may have more than this list shows.',
                )
              : t(
                  'Nuphos has no record of which resources this Watch created. Check the provider by hand.',
                )}
          </span>
          {resources.length > 0 && (
            <span className="mt-1.5 block space-y-1">
              {resources.map((resource) => (
                <span key={resource.id} className="block break-words">
                  {resource.kind} ·{' '}
                  {resource.url ? (
                    <a href={resource.url} target="_blank" rel="noreferrer" className="underline">
                      {resource.name}
                    </a>
                  ) : (
                    resource.name
                  )}
                </span>
              ))}
            </span>
          )}
        </span>
      }
      confirmLabel={t('Remove without provider cleanup')}
      destructive
      onClose={onClose}
      onConfirm={onConfirm}
    />
  )
}
