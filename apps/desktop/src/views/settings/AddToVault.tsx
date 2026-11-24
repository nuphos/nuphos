import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { MenuItem } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import type { AgentDevice } from '../../api'

/**
 * "Add to Vault…" for another computer this person manages (nuphos/nuphos#5016): it
 * makes its own vault key and waits on the Vault page for an approval, as after
 * `nuphos vault enroll` there.
 */
export function useAddToVault(device: AgentDevice, teamId: string) {
  const queryClient = useQueryClient()
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
          'Once you approve it, everything on that computer, its Bots and Tasks included, can read your vault. Its key passes through Nuphos, as with `nuphos vault enroll` in a Nuphos terminal; for your most sensitive computers, enroll over your own SSH instead.',
        )}
        confirmLabel={t('Add to Vault')}
        onConfirm={() => void add()}
        onClose={() => setOpen(false)}
      />
    ),
  }
}
