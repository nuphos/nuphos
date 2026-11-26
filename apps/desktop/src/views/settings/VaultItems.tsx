import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { api } from '../../api'
import { relativeTimeFromNow } from '../../components/agent/panel/textUtils'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'
import { vaultItemsQuery } from '../../lib/query/vault'

import { inputClasses } from './styles'
import { vaultCard } from './VaultDevices'
import { VaultSharePicker } from './VaultSharePicker'

import type { VaultDevice, VaultItemSummary } from '../../types/vault'

type Props = { userId: string; thisDeviceId: string; devices: VaultDevice[] }

/**
 * The vault's items, for an enrolled device. A value is read only when asked for. Each
 * item is shared with the devices it picks (nuphos/nuphos#5088): by default, the one
 * that saves it.
 */
export function VaultItems({ userId, thisDeviceId, devices }: Props) {
  const queryClient = useQueryClient()
  const items = useQuery(vaultItemsQuery(userId))
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  // Picked for the item being saved; until then, what it is shared with now.
  const [picked, setPicked] = useState<string[] | null>(null)
  const existing = items.data?.find((item) => item.name === name.trim())
  const chosen = picked ?? existing?.deviceIds ?? [thisDeviceId]
  const valueRef = useRef<HTMLTextAreaElement>(null)
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
    // Saved on each toggle; the list is read again before the next one can be made.
    mutationFn: ({ item, ids }: { item: VaultItemSummary; ids: string[] }) =>
      api.vaultShare(item.name, ids, item.updatedAt),
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
          ref={valueRef}
          aria-label={t('Value')}
          className={`${inputClasses} h-20 py-2 font-mono`}
          placeholder={t('Value')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div>
          <p className="mb-1 text-[12px] text-tertiary">{t('Shared with')}</p>
          <VaultSharePicker
            variant="field"
            devices={devices}
            thisDeviceId={thisDeviceId}
            chosen={chosen}
            shared={existing?.deviceIds ?? []}
            onChange={setPicked}
            onReplaceValue={() => valueRef.current?.focus()}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-tertiary">
            {t('Saving an existing name replaces its value.')}
          </p>
          <Button
            type="submit"
            size="sm"
            disabled={!name.trim() || !value || !chosen.length || save.isPending}
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
                <div className="flex items-center gap-1 text-[12px] text-tertiary">
                  <span className="shrink-0">{relativeTimeFromNow(item.updatedAt)} ·</span>
                  <VaultSharePicker
                    variant="chip"
                    devices={devices}
                    thisDeviceId={thisDeviceId}
                    chosen={item.deviceIds}
                    shared={item.deviceIds}
                    onChange={(ids) => share.mutateAsync({ item, ids })}
                    onReplaceValue={() => {
                      setName(item.name)
                      setPicked(null)
                      valueRef.current?.focus()
                    }}
                  />
                </div>
              </div>
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
