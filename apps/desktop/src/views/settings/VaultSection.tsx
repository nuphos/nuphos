import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { INLINE_LINK } from '../../components/ui/inline-link'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'
import { vaultStatusQuery } from '../../lib/query/vault'

import { SectionHeader } from './shared'
import { VaultDevices, vaultCard } from './VaultDevices'
import { VaultItems } from './VaultItems'

import type { VaultDevice } from '../../types/vault'

const VAULT_DOCS_URL = 'https://docs.nuphos.ai/security/vault'

/** Vault: secrets encrypted on the user's own devices. Keys stay in the main process. */
export function VaultSection({ userId }: { userId: string }) {
  const status = useQuery(vaultStatusQuery(userId))
  const devices = status.data?.devices ?? []
  const mine = devices.find((d) => d.id === status.data?.thisDeviceId)

  return (
    <div>
      <SectionHeader
        title={t('Vault')}
        description={t(
          'Secrets encrypted on your own devices. Nuphos stores only ciphertext and cannot read them.',
        )}
      />
      <div className={`${vaultCard} mb-6`}>
        <p className="text-[13px] text-main">{t('How does Nuphos keep your secrets safe?')}</p>
        <p className="mt-1 text-[12.5px] text-tertiary">
          {t(
            'Item values are encrypted on your enrolled devices before they are uploaded. The Nuphos server stores them encrypted and never holds a key that can decrypt them. Item names are not encrypted.',
          )}{' '}
          <button
            type="button"
            className={INLINE_LINK}
            onClick={() => void api.appOpenExternal(VAULT_DOCS_URL)}
          >
            {t('Learn more')}
          </button>
        </p>
      </div>
      {status.isPending && <p className="text-[12.5px] text-tertiary">{t('Loading…')}</p>}
      {status.isError && (
        <p className="text-[12.5px] text-tertiary">
          {t('Couldn’t load your vault.')}{' '}
          <Button type="button" size="sm" variant="secondary" onClick={() => void status.refetch()}>
            {t('Retry')}
          </Button>
        </p>
      )}
      {status.isSuccess && <ThisComputer userId={userId} mine={mine} first={!devices.length} />}
      {devices.length > 0 && <VaultDevices userId={userId} devices={devices} mine={mine} />}
      {mine?.state === 'enrolled' && <VaultItems userId={userId} />}
    </div>
  )
}

/** Adding this computer, or the fingerprint it shows while it waits for approval. */
function ThisComputer({
  userId,
  mine,
  first,
}: {
  userId: string
  mine: VaultDevice | undefined
  first: boolean
}) {
  const queryClient = useQueryClient()
  const enroll = useMutation({
    mutationFn: () => api.vaultEnroll(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.vault(userId) }),
    onError: (err) => toast.apiError(t('Could not add this computer to your vault'), err),
  })

  if (mine?.state === 'enrolled') return null
  if (mine)
    return (
      <div className={`${vaultCard} mb-6`}>
        <p className="text-[13px] text-main">{t('This computer waits for approval.')}</p>
        <p className="mt-1 text-[12.5px] text-tertiary">
          {t(
            'Approve it from a device already in your vault and check that it shows this fingerprint:',
          )}
        </p>
        <p className="mt-2 font-mono text-[13px] text-main">{mine.fingerprint}</p>
      </div>
    )

  return (
    <div className={`${vaultCard} mb-6`}>
      <p className="text-[13px] text-main">{t('This computer is not in your vault.')}</p>
      <p className="mt-1 text-[12.5px] text-tertiary">
        {first
          ? t('Your first device is trusted as soon as you add it.')
          : t('After adding it, approve it from a device already in your vault.')}
      </p>
      <Button
        type="button"
        size="sm"
        className="mt-3"
        disabled={enroll.isPending}
        onClick={() => enroll.mutate()}
      >
        {t('Add this computer')}
      </Button>
    </div>
  )
}
