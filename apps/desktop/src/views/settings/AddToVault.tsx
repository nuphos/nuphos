import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { MenuItem } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { queryClient } from '../../lib/query/client'

import type { AgentDevice } from '../../api'

/**
 * "Add to Vault…" for another computer this person manages (nuphos/nuphos#5016): it
 * makes its own vault key and waits on the Vault page for an approval, as after
 * `nuphos vault enroll` there.
 */
export function useAddToVault(device: AgentDevice, teamId: string) {
  const [open, setOpen] = useState(false)
  const add = async () => {
    try {
      const added = await api.vaultAddComputer(device.deviceId, teamId)

      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[2] === 'vault' })
      toast.success(
        t('{name} waits for approval on the Vault page', { name: device.label }),
        t('Fingerprint {fingerprint}', { fingerprint: added.fingerprint }),
      )
    } catch (error) {
      toast.apiError(t('Could not add the computer to your vault'), error)
    }
  }

  return {
    menuItem: <MenuItem onClick={() => setOpen(true)}>{t('Add to Vault…')}</MenuItem>,
    dialog: (
      <ConfirmDialog
        open={open}
        title={t('Add {name} to your vault?', { name: device.label })}
        description={t(
          'Once you approve it, every program on that computer can read the vault items you share with it, its Bots and Tasks included, and so can anyone using its user account; on a shared computer, that includes whoever owns that account. Its key passes through Nuphos, as with `nuphos vault enroll` in a Nuphos terminal. For your most sensitive computers, enroll over your own SSH with the CLI instead.',
        )}
        confirmLabel={t('Add to Vault')}
        onConfirm={() => void add()}
        onClose={() => setOpen(false)}
      />
    ),
  }
}
