import clsx from 'clsx'
import { GitBranch, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { fieldClass } from '../../components/ui/input-group'
import { toast } from '../../components/ui/toast'
import { formatBytes } from '../../grafana/format'
import { t } from '../../i18n'

import { installableNames, MAX_INSTALL_NAMES, previewSourceLabel } from './githubSkillInstall'

import type { GithubSkillCandidate, GithubSkillPreview, SkillScope } from '../../api'

function SkillPickerRow({
  skill,
  checked,
  full,
  onChange,
}: {
  skill: GithubSkillCandidate
  checked: boolean
  /** The selection is at the per-install limit; only already picked rows stay toggleable. */
  full: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2 py-1.5">
      <Checkbox
        className="mt-0.5"
        disabled={skill.problem !== null || (full && !checked)}
        checked={checked}
        onCheckedChange={onChange}
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[12.5px]">{skill.name}</span>
        <span className="truncate text-[11px] text-tertiary">
          {t('{count} files', { count: String(skill.fileCount) })} · {formatBytes(skill.totalBytes)}
          {skill.description ? ` · ${skill.description}` : ''}
        </span>
        {skill.problem && (
          <span className="text-[11px] text-status-danger">{skill.problem.message}</span>
        )}
        {skill.skipped.length > 0 && (
          <span className="truncate text-[11px] text-tertiary">
            {t('Links not installed: {names}', { names: skill.skipped.join(', ') })}
          </span>
        )}
      </span>
    </label>
  )
}

function PickerNotes({ full, truncated }: { full: boolean; truncated: boolean }) {
  return (
    <>
      {full && (
        <div className="py-1 text-[11px] text-tertiary">
          {t('Up to {count} skills can be installed at once.', {
            count: String(MAX_INSTALL_NAMES),
          })}
        </div>
      )}
      {truncated && (
        <div className="py-1 text-[11px] text-tertiary">
          {t('Only the first 100 skills are shown; paste a folder to narrow it down.')}
        </div>
      )}
    </>
  )
}

type DialogProps = {
  teamId: string
  scope: SkillScope
  disabled: boolean
  onInstalled: (name: string) => void
}

/** Paste a public GitHub source like `npx skills add` takes, pick the skills it
 *  offers, and install them into the store being viewed. */
export function GithubSkillInstallDialog({ teamId, scope, disabled, onInstalled }: DialogProps) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState('')
  // Kept with the source text it was fetched for, so install never pairs it with later edits.
  const [preview, setPreview] = useState<(GithubSkillPreview & { source: string }) | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setPreview(null)
    setSelected([])
    setError(null)
  }

  const toggle = (name: string, checked: boolean) =>
    setSelected((names) => names.filter((n) => n !== name).concat(checked ? [name] : []))

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

  const find = () =>
    run(async () => {
      const requested = source.trim()
      const result = await api.teamSkillsGithubPreview(teamId, requested, scope)

      setPreview({ ...result, source: requested })
      setSelected(installableNames(result))
    })

  const install = (from: GithubSkillPreview & { source: string }) =>
    run(async () => {
      const { installed } = await api.teamSkillsGithubInstall(
        teamId,
        { source: from.source, commitSha: from.commitSha, names: selected },
        scope,
      )

      toast.success(
        installed.length === 1
          ? t('Installed {name}', { name: installed[0]?.name ?? '' })
          : t('Installed {count} skills', { count: String(installed.length) }),
        previewSourceLabel(from),
      )
      setOpen(false)
      if (installed[0]) onInstalled(installed[0].name)
    })

  const close = () => {
    if (!pending) setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          reset()
          setOpen(true)
        }}
        className="h-7 px-2 flex items-center gap-1.5 rounded-md text-[12px] text-secondary hover:text-main hover:bg-state-hover disabled:text-tertiary"
        title={t('Install skills from a GitHub repository')}
      >
        <GitBranch className="w-3.5 h-3.5" strokeWidth={2} />
        <span>{t('Install from GitHub')}</span>
      </button>
      <Modal
        open={open}
        onClose={close}
        title={t('Install from GitHub')}
        description={t(
          'A public repository, folder or tree URL, e.g. owner/repo or owner/repo#ref.',
        )}
        width={520}
        closeOnBackdrop={false}
        footer={
          <div className="flex items-center justify-end gap-2">
            {pending && <Loader2 className="mr-auto h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={close}>
              {t('Cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending || !preview || selected.length === 0}
              onClick={() => preview && void install(preview)}
            >
              {t('Install')}
            </Button>
          </div>
        }
      >
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (source.trim()) void find()
          }}
        >
          <input
            className={clsx(fieldClass, 'h-8')}
            value={source}
            disabled={pending}
            placeholder="anthropics/skills"
            onChange={(event) => {
              setSource(event.target.value)
              reset()
            }}
          />
          <Button type="submit" variant="secondary" size="sm" disabled={pending || !source.trim()}>
            {t('Find skills')}
          </Button>
        </form>
        {preview && (
          <div className="mt-3">
            <div className="py-1 text-[11px] text-tertiary">{previewSourceLabel(preview)}</div>
            {preview.skills.length === 0 && (
              <div className="py-2 text-[12px] text-tertiary">
                {t('No skills found in this source')}
              </div>
            )}
            {preview.skills.map((skill) => (
              <SkillPickerRow
                key={skill.name}
                skill={skill}
                checked={selected.includes(skill.name)}
                full={selected.length >= MAX_INSTALL_NAMES}
                onChange={(checked) => toggle(skill.name, checked)}
              />
            ))}
            <PickerNotes
              full={selected.length >= MAX_INSTALL_NAMES}
              truncated={preview.truncated}
            />
          </div>
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
