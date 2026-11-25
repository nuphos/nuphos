import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'
import { teamVaultStatusQuery } from '../../lib/query/vault'

import { vaultCard } from './VaultDevices'
import { VaultItems } from './VaultItems'

import type { AtlasTeam } from '../../types'
import type { TeamVaultDevice } from '../../types/vault'

const badge =
  'shrink-0 rounded bg-state-selected px-1.5 py-0.5 text-[11px] font-normal text-secondary'

type Action = { device: TeamVaultDevice; action: 'add' | 'remove' }

/**
 * The team's shared vault (nuphos/nuphos#5080): items every member can read from
 * the devices in it. A device joins when one already in it wraps every key for it.
 */
export function TeamVault({ userId, team }: { userId: string; team: AtlasTeam }) {
  const queryClient = useQueryClient()
  const status = useQuery(teamVaultStatusQuery(team.id))
  const [confirming, setConfirming] = useState<Action | null>(null)
  const devices = status.data?.devices ?? []
  const mine = devices.find((d) => d.id === status.data?.thisDeviceId)
  const started = devices.some((d) => d.shared)
  const act = useMutation({
    mutationFn: ({ device, action }: Action) =>
      action === 'add'
        ? api.vaultAddTeamDevice(team.id, device.id, device.fingerprint)
        : api.vaultRemoveTeamDevice(team.id, device.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.teamVault(team.id) }),
    onError: (err) => toast.apiError(t('Could not update the team vault'), err),
  })

  if (!status.isSuccess || !mine) return null

  return (
    <div className="mt-10">
      <h2 className="mb-1 text-[13.5px] font-medium text-main">
        {t('{team} vault', { team: team.name })}
      </h2>
      <p className="mb-3 text-[12.5px] text-tertiary">
        {t(
          'Shared with every member of this team, and encrypted for the devices in it. Removing someone stops their devices reading at once, but they keep whatever they already read: rotate those secrets.',
        )}
      </p>
      {!mine.shared && (
        <div className={`${vaultCard} mb-4`}>
          {started ? (
            <>
              <p className="text-[13px] text-main">
                {t('This computer is not in the team vault.')}
              </p>
              <p className="mt-1 text-[12.5px] text-tertiary">
                {t('Ask a teammate to add it, and check that they see this fingerprint:')}
              </p>
              <p className="mt-2 font-mono text-[13px] text-main">{mine.fingerprint}</p>
            </>
          ) : (
            <>
              <p className="text-[13px] text-main">{t('No one has started this team’s vault.')}</p>
              <Button
                type="button"
                size="sm"
                className="mt-3"
                disabled={act.isPending}
                onClick={() => act.mutate({ device: mine, action: 'add' })}
              >
                {t('Start with this computer')}
              </Button>
            </>
          )}
        </div>
      )}
      <div className="mb-6 space-y-2">
        {devices.map((device) => (
          <div key={device.id} className={`${vaultCard} flex items-center gap-4`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13.5px] font-medium text-main">
                <span className="truncate">{device.name}</span>
                <span className="truncate font-normal text-tertiary">{device.userName}</span>
                {device.shared && <span className={badge}>{t('In team vault')}</span>}
              </div>
              <p className="mt-0.5 font-mono text-[12px] text-tertiary">{device.fingerprint}</p>
            </div>
            {mine.shared && (
              <Button
                type="button"
                size="sm"
                variant={device.shared ? 'secondary' : 'primary'}
                disabled={act.isPending}
                onClick={() => setConfirming({ device, action: device.shared ? 'remove' : 'add' })}
              >
                {device.shared ? t('Remove') : t('Add')}
              </Button>
            )}
          </div>
        ))}
      </div>
      {mine.shared && <VaultItems userId={userId} teamId={team.id} />}
      <ConfirmDialog
        open={confirming !== null}
        {...(confirming?.action === 'add'
          ? {
              title: t('Add {name} to the team vault?', { name: confirming.device.name }),
              description: (
                <>
                  {t(
                    'Add it only if the device shows this fingerprint. It will read every item in the team vault.',
                  )}
                  <span className="mt-2 block font-mono text-main">
                    {confirming.device.fingerprint}
                  </span>
                </>
              ),
              confirmLabel: t('Add'),
            }
          : {
              title: t('Remove {name} from the team vault?', {
                name: confirming?.device.name ?? '',
              }),
              description: t(
                'It cannot read new values, but items are not re-encrypted: whatever it already read stays with it. Rotate those secrets.',
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
    </div>
  )
}
