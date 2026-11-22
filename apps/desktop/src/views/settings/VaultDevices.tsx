import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'

import type { VaultDevice } from '../../types/vault'

export const vaultCard = 'rounded-lg border border-line-control/70 bg-surface px-4 py-3'

const badge =
  'shrink-0 rounded bg-state-selected px-1.5 py-0.5 text-[11px] font-normal text-secondary'

type Action = { device: VaultDevice; action: 'approve' | 'remove' }

/** The vault's devices. A pending one is approved only after its fingerprint is compared. */
export function VaultDevices({
  userId,
  devices,
  mine,
}: {
  userId: string
  devices: VaultDevice[]
  mine: VaultDevice | undefined
}) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<Action | null>(null)
  const act = useMutation({
    mutationFn: ({ device, action }: Action) =>
      action === 'approve' ? api.vaultApprove(device.id) : api.vaultRemoveDevice(device.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.vault(userId) }),
    onError: (err) => toast.apiError(t('Could not update the device'), err),
  })
  const canApprove = mine?.state === 'enrolled'

  return (
    <>
      <h2 className="mb-2 text-[13.5px] font-medium text-main">{t('Devices')}</h2>
      <div className="mb-8 space-y-2">
        {devices.map((device) => (
          <div key={device.id} className={`${vaultCard} flex items-center gap-4`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13.5px] font-medium text-main">
                <span className="truncate">{device.name}</span>
                {device.id === mine?.id && <span className={badge}>{t('This device')}</span>}
                {device.state === 'pending' && (
                  <span className={badge}>{t('Waiting for approval')}</span>
                )}
              </div>
              <p className="mt-0.5 font-mono text-[12px] text-tertiary">{device.fingerprint}</p>
            </div>
            {canApprove && device.state === 'pending' && (
              <Button
                type="button"
                size="sm"
                disabled={act.isPending}
                onClick={() => setConfirming({ device, action: 'approve' })}
              >
                {t('Approve')}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={act.isPending}
              onClick={() => setConfirming({ device, action: 'remove' })}
            >
              {t('Remove')}
            </Button>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={confirming !== null}
        {...(confirming?.action === 'approve'
          ? {
              title: t('Approve {name}?', { name: confirming.device.name }),
              description: (
                <>
                  {t(
                    'Approve only if the device shows this fingerprint. It will read every item in your vault.',
                  )}
                  <span className="mt-2 block font-mono text-main">
                    {confirming.device.fingerprint}
                  </span>
                </>
              ),
              confirmLabel: t('Approve'),
            }
          : {
              title: t('Remove {name} from your vault?', { name: confirming?.device.name ?? '' }),
              description: t(
                'Items are not re-encrypted: a copy that device already kept stays readable to it.',
              ),
              confirmLabel: t('Remove'),
              destructive: true,
            })}
        onConfirm={() => {
          if (confirming) act.mutate(confirming)
          setConfirming(null)
        }}
        onClose={() => setConfirming(null)}
      />
    </>
  )
}
