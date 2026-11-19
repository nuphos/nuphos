import { api } from '../../api'
import type { AgentDevice } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

/** Delete, from a Box's ⋯ menu: always deleted, and the owner hears when its machine may still run. */
export const deleteBox = async (device: AgentDevice, teamId: string) => {
  const { machineLeft } = await api.boxDelete(device.deviceId, teamId)

  if (machineLeft)
    toast.info(
      t('{name} was deleted', { name: device.label }),
      t(
        "instabox could not stop its machine, so it may still be running there. Check the team's instabox account.",
      ),
    )
}
