import { ConfirmDialog } from '../../components/ConfirmDialog'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

export type DisconnectTarget = {
  id: string
  name: string
  action: () => Promise<void>
}

export function DisconnectConnectorDialog({
  target,
  onClose,
  onDisconnected,
  onFailed,
}: {
  target: DisconnectTarget
  onClose: () => void
  onDisconnected: (id: string) => void
  /** A grouped disconnect can fail part-way after unbinding some members, so the caller resyncs. */
  onFailed?: () => void
}) {
  return (
    <ConfirmDialog
      open
      title={t('Disconnect {name}?', { name: target.name })}
      description={t('Nuphos will lose access to this connection. You can connect it again later.')}
      confirmLabel={t('Disconnect')}
      destructive
      onClose={onClose}
      onConfirm={async () => {
        try {
          await target.action()
          onDisconnected(target.id)
          toast.success(t('Disconnected {name}', { name: target.name }))
        } catch (error) {
          toast.apiError(t('Could not disconnect {name}', { name: target.name }), error)
          onFailed?.()
          throw error
        }
      }}
    />
  )
}
