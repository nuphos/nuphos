import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

/** Delete, from a Box's ⋯ menu: always deleted, and the owner hears when its machine may still run. */
export const deleteBox = (name: string) => async (deviceId: string, teamId: string) => {
  const { machineLeft } = await api.boxDelete(deviceId, teamId)

  if (machineLeft)
    toast.info(
      t('{name} was deleted', { name }),
      t(
        "Its machine on instabox couldn't be stopped and may still be running. Check your team's instabox account.",
      ),
    )
}
