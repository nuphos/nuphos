import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../../api'
import { relativeTimeFromNow } from '../../components/agent/panel/textUtils'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'
import { vaultItemsQuery } from '../../lib/query/vault'

import { inputClasses } from './styles'
import { vaultCard } from './VaultDevices'

import type { VaultDevice, VaultItemSummary } from '../../types/vault'

/** Enrolled devices to pick from, computers marked: an item reaches only the ones picked. */
function DevicePicker({
  devices,
  chosen,
  onChange,
}: {
  devices: VaultDevice[]
  chosen: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {devices.map((device) => (
        <label key={device.id} className="flex items-center gap-1.5 text-[12.5px] text-main">
          <Checkbox
            checked={chosen.includes(device.id)}
            onCheckedChange={(checked) =>
              onChange(checked ? [...chosen, device.id] : chosen.filter((id) => id !== device.id))
            }
          />
          {device.name}
          {device.computer && <span className="text-tertiary">{t('computer')}</span>}
        </label>
      ))}
    </div>
  )
}

/** True when one of this person's own devices is picked, so they can still open the item. */
const ownPicked = (devices: VaultDevice[], ids: string[]) =>
  devices.some((d) => !d.computer && ids.includes(d.id))

type Sharing = { item: VaultItemSummary; chosen: string[] }

/** Picks the devices an item is shared with; one left out may have kept what it read. */
function ShareDialog({
  sharing,
  devices,
  onChange,
  onSave,
}: {
  sharing: Sharing | null
  devices: VaultDevice[]
  onChange: (sharing: Sharing | null) => void
  onSave: (sharing: Sharing) => Promise<void>
}) {
  return (
    <ConfirmDialog
      open={sharing !== null}
      title={t('Who can open {name}?', { name: sharing?.item.name ?? '' })}
      description={
        sharing && (
          <>
            <span className="mb-3 block">
              {t('Only the devices you pick get its key. A computer reads it with its own key.')}
            </span>
            <DevicePicker
              devices={devices}
              chosen={sharing.chosen}
              onChange={(ids) => onChange({ ...sharing, chosen: ids })}
            />
            {sharing.item.deviceIds.some((id) => !sharing.chosen.includes(id)) && (
              <span className="mt-3 block text-main">
                {t(
                  'A device you remove may have kept the value it already read. Change the secret where it was issued, then save the new value here.',
                )}
              </span>
            )}
          </>
        )
      }
      confirmLabel={t('Save')}
      // A refusal is shown in the dialog, which stays open.
      onConfirm={async () => {
        if (!sharing) return
        if (!ownPicked(devices, sharing.chosen))
          throw new Error(t('Pick at least one of your own devices.'))
        await onSave(sharing)
      }}
      onClose={() => onChange(null)}
    />
  )
}

/**
 * The vault's items, for an enrolled device. A value is read only when asked for. Each
 * item is shared with the devices it picks (nuphos/nuphos#5088): by default this
 * person's own devices, never a computer until it is picked.
 */
export function VaultItems({ userId, devices }: { userId: string; devices: VaultDevice[] }) {
  const queryClient = useQueryClient()
  const items = useQuery(vaultItemsQuery(userId))
  const enrolled = devices.filter((d) => d.state === 'enrolled')
  const nameOf = (id: string) => devices.find((d) => d.id === id)?.name
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  // Picked for the item being saved; until then, what it is shared with now.
  const [picked, setPicked] = useState<string[] | null>(null)
  const existing = items.data?.find((item) => item.name === name.trim())
  const chosen =
    picked ?? existing?.deviceIds ?? enrolled.filter((d) => !d.computer).map((d) => d.id)
  const [sharing, setSharing] = useState<Sharing | null>(null)
  // Values read on request, never in the query cache.
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<string | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.vaultItems(userId) })

  const save = useMutation({
    // A change made elsewhere since the list was read is refused, then the list refreshes.
    mutationFn: () => api.vaultSet(name.trim(), value, chosen, existing?.updatedAt ?? null),
    onSuccess: () => {
      toast.success(t('Saved {name}', { name: name.trim() }))
      setRevealed(({ [name.trim()]: _, ...rest }) => rest)
      setName('')
      setValue('')
      setPicked(null)
    },
    onSettled: refresh,
    onError: (err) => toast.apiError(t('Could not save the item'), err),
  })
  const share = useMutation({
    mutationFn: ({ item, chosen: ids }: Sharing) => api.vaultShare(item.name, ids, item.updatedAt),
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: (item: string) => api.vaultDelete(item),
    onSettled: refresh,
    onError: (err) => toast.apiError(t('Could not delete the item'), err),
  })

  async function reveal(item: string) {
    if (item in revealed) return setRevealed(({ [item]: _, ...rest }) => rest)
    try {
      const plain = await api.vaultGet(item)

      setRevealed((r) => ({ ...r, [item]: plain }))
    } catch (err) {
      toast.apiError(t('Could not open the item'), err)
    }
  }

  return (
    <>
      <h2 className="mb-2 text-[13.5px] font-medium text-main">{t('Items')}</h2>
      <form
        className={`${vaultCard} mb-3 space-y-2`}
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <input
          aria-label={t('Name')}
          className={inputClasses}
          placeholder={t('Name, e.g. github-token')}
          value={name}
          maxLength={128}
          onChange={(e) => {
            setName(e.target.value)
            setPicked(null)
          }}
        />
        <textarea
          aria-label={t('Value')}
          className={`${inputClasses} h-20 py-2 font-mono`}
          placeholder={t('Value')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <DevicePicker devices={enrolled} chosen={chosen} onChange={setPicked} />
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-tertiary">
            {t('Saving an existing name replaces its value.')}
          </p>
          <Button
            type="submit"
            size="sm"
            disabled={!name.trim() || !value || !ownPicked(enrolled, chosen) || save.isPending}
          >
            {t('Save')}
          </Button>
        </div>
      </form>
      <div className="space-y-2">
        {items.data?.length === 0 && (
          <p className="text-[12.5px] text-tertiary">{t('Your vault is empty.')}</p>
        )}
        {items.data?.map((item) => (
          <div key={item.name} className={vaultCard}>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13px] text-main">{item.name}</p>
                <p className="truncate text-[12px] text-tertiary">
                  {relativeTimeFromNow(item.updatedAt)} ·{' '}
                  {item.deviceIds.map((id) => nameOf(id) ?? id).join(', ')}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setSharing({ item, chosen: item.deviceIds })}
              >
                {t('Devices')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void reveal(item.name)}
              >
                {item.name in revealed ? t('Hide') : t('Show')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setDeleting(item.name)}
              >
                {t('Delete')}
              </Button>
            </div>
            {item.name in revealed && (
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-state-selected px-3 py-2 font-mono text-[12px] break-all whitespace-pre-wrap text-main">
                {revealed[item.name]}
              </pre>
            )}
          </div>
        ))}
      </div>
      <ShareDialog
        sharing={sharing}
        devices={enrolled}
        onChange={setSharing}
        onSave={(next) => share.mutateAsync(next)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={t('Delete {name}?', { name: deleting ?? '' })}
        description={t('Every device loses it. This cannot be undone.')}
        confirmLabel={t('Delete')}
        destructive
        onConfirm={() => {
          if (deleting) remove.mutate(deleting)
          setDeleting(null)
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
