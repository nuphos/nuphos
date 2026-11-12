import { Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import {
  canUpdate,
  defaultUpdateSelection,
  editedSelected,
  MAX_UPDATE_NAMES,
  reviewedCommits,
} from './githubSkillUpdates'

import type { GithubSkillUpdate, SkillScope } from '../../api'

function statusText(update: GithubSkillUpdate): string {
  if (update.status === 'up_to_date') return t('Up to date')
  if (update.status === 'source_missing') return t('Source folder no longer exists')
  const { added, changed, removed } = update.changes

  return t('{added} added, {changed} changed, {removed} removed', {
    added: String(added.length),
    changed: String(changed.length),
    removed: String(removed.length),
  })
}

function UpdateRow({
  update,
  checked,
  full,
  onChange,
}: {
  update: GithubSkillUpdate
  checked: boolean
  /** The selection is at the per-request limit; only picked rows stay toggleable. */
  full: boolean
  onChange: (checked: boolean) => void
}) {
  const { added, changed, removed } = update.changes
  const files = [
    ...added.map((f) => `+ ${f}`),
    ...changed.map((f) => `~ ${f}`),
    ...removed.map((f) => `- ${f}`),
  ]

  return (
    <label className="flex items-start gap-2 py-1.5">
      <Checkbox
        className="mt-0.5"
        disabled={!canUpdate(update) || (full && !checked)}
        checked={checked}
        onCheckedChange={onChange}
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[12.5px]">{update.name}</span>
        <span className="truncate text-[11px] text-tertiary">
          {update.repo}
          {update.ref ? ` @ ${update.ref}` : ''} · {update.installedCommit.slice(0, 7)}
          {update.latestCommit && update.status === 'update_available'
            ? ` → ${update.latestCommit.slice(0, 7)}`
            : ''}
        </span>
        <span className="truncate text-[11px] text-secondary" title={files.join('\n')}>
          {statusText(update)}
        </span>
        {update.edited && (
          <span className="text-[11px] text-status-warning">{t('Edited in Nuphos')}</span>
        )}
        {update.problem && (
          <span className="text-[11px] text-status-danger">{update.problem.message}</span>
        )}
      </span>
    </label>
  )
}

/** Checks the skills installed from GitHub against their sources and applies picked updates.
 *  Skills edited in Nuphos start unpicked and need an explicit confirmation to overwrite. */
export function GithubSkillUpdatesDialog({
  teamId,
  scope,
  disabled,
  onUpdated,
}: {
  teamId: string
  scope: SkillScope
  disabled: boolean
  onUpdated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [updates, setUpdates] = useState<GithubSkillUpdate[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const overwrite = updates ? editedSelected(updates, selected) : []

  const run = async (action: () => Promise<void>) => {
    setPending(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(parseAtlasError(err).message)
    } finally {
      setPending(false)
    }
  }

  const check = () =>
    run(async () => {
      const result = await api.teamSkillsGithubUpdates(teamId, scope)

      setUpdates(result.updates)
      setSelected(defaultUpdateSelection(result.updates))
      setConfirmed(false)
    })

  const apply = () =>
    run(async () => {
      const { updated } = await api.teamSkillsGithubUpdate(
        teamId,
        {
          names: selected,
          overwriteEdited: overwrite,
          commits: reviewedCommits(updates ?? [], selected),
        },
        scope,
      )

      toast.success(
        updated.length === 1
          ? t('Updated {name}', { name: updated[0]?.name ?? '' })
          : t('Updated {count} skills', { count: String(updated.length) }),
      )
      setOpen(false)
      onUpdated()
    })

  const toggle = (name: string, checked: boolean) => {
    setSelected((names) => names.filter((n) => n !== name).concat(checked ? [name] : []))
    setConfirmed(false)
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setUpdates(null)
          setOpen(true)
          void check()
        }}
        className="h-7 px-2 flex items-center gap-1.5 rounded-md text-[12px] text-secondary hover:text-main hover:bg-state-hover disabled:text-tertiary"
        title={t('Check skills installed from GitHub for updates')}
      >
        <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
        <span>{t('Check for updates')}</span>
      </button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={t('Skill updates')}
        width={520}
        closeOnBackdrop={false}
        footer={
          <div className="flex items-center justify-end gap-2">
            {pending && <Loader2 className="mr-auto h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending || selected.length === 0 || (overwrite.length > 0 && !confirmed)}
              onClick={() => void apply()}
            >
              {t('Update')}
            </Button>
          </div>
        }
      >
        {!updates && pending && (
          <div className="text-[12px] text-tertiary">{t('Checking for updates...')}</div>
        )}
        {updates?.length === 0 && (
          <div className="text-[12px] text-tertiary">
            {t('No skills installed from GitHub in this scope')}
          </div>
        )}
        {updates?.map((update) => (
          <UpdateRow
            key={update.name}
            update={update}
            checked={selected.includes(update.name)}
            full={selected.length >= MAX_UPDATE_NAMES}
            onChange={(checked) => toggle(update.name, checked)}
          />
        ))}
        {selected.length >= MAX_UPDATE_NAMES && (
          <div className="py-1 text-[11px] text-tertiary">
            {t('Up to {count} skills can be updated at once.', { count: String(MAX_UPDATE_NAMES) })}
          </div>
        )}
        {overwrite.length > 0 && (
          <label className="mt-2 flex items-start gap-2 rounded-md border border-line-control px-2.5 py-2 text-[12px]">
            <Checkbox className="mt-0.5" checked={confirmed} onCheckedChange={setConfirmed} />
            <span>
              {t('Replace the edits made in Nuphos to {names}', { names: overwrite.join(', ') })}
            </span>
          </label>
        )}
        {error && (
          <div className="mt-2 rounded-md border border-error/25 bg-error/10 px-2.5 py-2 text-[12px] text-error">
            {error}
          </div>
        )}
      </Modal>
    </>
  )
}
