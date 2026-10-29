import type { AgentDevice } from '../../api'
import { toast } from '../../components/ui/toast'

/** Copy UID, from a machine's ⋯ menu. */
export const copyUid = (device: AgentDevice) =>
  navigator.clipboard.writeText(device.deviceId).then(
    () => toast.success('UID copied'),
    () => toast.error('Could not copy the UID'),
  )
