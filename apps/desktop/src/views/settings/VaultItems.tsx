import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

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

/** The vault's items, for an enrolled device. A value is read only when asked for. */
export function VaultItems({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const items = useQuery(vaultItemsQuery(userId))
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  // Values read on request, never in the query cache.
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<string | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.vaultItems(userId) })

  const save = useMutation({
    mutationFn: () => api.vaultSet(name.trim(), value),
    onSuccess: () => {
      toast.success(t('Saved {name}', { name: name.trim() }))
      setRevealed(({ [name.trim()]: _, ...rest }) => rest)
      setName('')
      setValue('')
    },
    onSettled: refresh,
    onError: (err) => toast.apiError(t('Could not save the item'), err),
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
          onChange={(e) => setName(e.target.value)}
        />
        <textarea
          aria-label={t('Value')}
          className={`${inputClasses} h-20 py-2 font-mono`}
          placeholder={t('Value')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-tertiary">
            {t('Saving an existing name replaces its value.')}
          </p>
          <Button type="submit" size="sm" disabled={!name.trim() || !value || save.isPending}>
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
                <p className="text-[12px] text-tertiary">{relativeTimeFromNow(item.updatedAt)}</p>
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
