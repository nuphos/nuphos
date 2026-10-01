import { ConfirmDialog } from '../../components/ConfirmDialog'
import { toast } from '../../components/ui/toast'

export type DisconnectTarget = {
  id: string
  name: string
  action: () => Promise<void>
}

export function DisconnectConnectorDialog({
  target,
  onClose,
  onDisconnected,
}: {
  target: DisconnectTarget
  onClose: () => void
  onDisconnected: (id: string) => void
}) {
  return (
    <ConfirmDialog
      open
      title={`Disconnect ${target.name}?`}
      description="Nuphos will lose access to this connection. You can connect it again later."
      confirmLabel="Disconnect"
      destructive
      onClose={onClose}
      onConfirm={async () => {
        try {
          await target.action()
          onDisconnected(target.id)
        } catch (error) {
          toast.apiError('Could not disconnect connector', error)
          throw error
        }
      }}
    />
  )
}
