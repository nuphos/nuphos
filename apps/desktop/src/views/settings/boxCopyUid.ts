import type { AgentDevice } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

/** Copy UID, from a machine's ⋯ menu. */
export const copyUid = (device: AgentDevice) =>
  navigator.clipboard.writeText(device.deviceId).then(
    () => toast.success(t('UID copied')),
    () => toast.error(t('Could not copy the UID')),
  )
