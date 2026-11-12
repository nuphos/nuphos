import clsx from 'clsx'
import { GitBranch, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { fieldClass } from '../../components/ui/input-group'
import { formatBytes } from '../../grafana/format'
import { t } from '../../i18n'

import { installableNames, MAX_INSTALL_NAMES, previewSourceLabel } from './githubSkillInstall'
import { SkillImportResults } from './SkillImportResults'
import { SkillPicker } from './SkillPicker'

import type { SkillImportResult } from './SkillImportResults'
import type { SkillPickerItem } from './SkillPicker'
import type { GithubSkillCandidate, GithubSkillPreview, SkillScope } from '../../api'

/** Why a candidate cannot be installed, or which of its links stay behind. */
function candidateDetail(skill: GithubSkillCandidate) {
  if (skill.problem) return <span className="text-status-danger">{skill.problem.message}</span>
  if (skill.skipped.length === 0) return null

  return <span>{t('Links not installed: {names}', { names: skill.skipped.join(', ') })}</span>
}

/** Every candidate as a picker row; one the backend would refuse, or past the limit, is shown disabled. */
function pickerItems(preview: GithubSkillPreview, selected: readonly string[]): SkillPickerItem[] {
  const full = selected.length >= MAX_INSTALL_NAMES

  return preview.skills.map((skill) => ({
    id: skill.name,
    title: skill.name,
    subtitle: [
      t('{count} files', { count: String(skill.fileCount) }),
      formatBytes(skill.totalBytes),
      skill.description,
    ]
      .filter(Boolean)
      .join(' · '),
    detail: candidateDetail(skill),
    disabled: skill.problem !== null || (full && !selected.includes(skill.name)),
  }))
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

function GithubSourceStep({
  source,
  pending,
  preview,
  selected,
  onSource,
  onFind,
  onChoose,
}: {
  source: string
  pending: boolean
  preview: GithubSkillPreview | null
  selected: readonly string[]
  onSource: (value: string) => void
  onFind: () => void
  onChoose: (next: ReadonlySet<string>) => void
}) {
  return (
    <>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (source.trim()) onFind()
        }}
      >
        <input
          className={clsx(fieldClass, 'h-8')}
          value={source}
          disabled={pending}
          placeholder="anthropics/skills"
          onChange={(event) => onSource(event.target.value)}
        />
        <Button type="submit" variant="secondary" size="sm" disabled={pending || !source.trim()}>
          {t('Find skills')}
        </Button>
      </form>
      {preview && (
        <div className="mt-3">
          <div className="py-1 text-[11px] text-tertiary">{previewSourceLabel(preview)}</div>
          {preview.skills.length === 0 ? (
            <div className="py-2 text-[12px] text-tertiary">
              {t('No skills found in this source')}
            </div>
          ) : (
            <SkillPicker
              items={pickerItems(preview, selected)}
              selected={new Set(selected)}
              onChange={onChoose}
            />
          )}
          <PickerNotes full={selected.length >= MAX_INSTALL_NAMES} truncated={preview.truncated} />
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
  // The install succeeded: what it installed, from where.
  const [installed, setInstalled] = useState<{ results: SkillImportResult[]; from: string } | null>(
    null,
  )

  const reset = () => {
    setPreview(null)
    setSelected([])
    setError(null)
    setInstalled(null)
  }

  // In the preview's order and never past the per-install limit, so Select all stops there too.
  const choose = (from: GithubSkillPreview, next: ReadonlySet<string>) =>
    setSelected(
      from.skills
        .map((skill) => skill.name)
        .filter((name) => next.has(name))
        .slice(0, MAX_INSTALL_NAMES),
    )

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
      const { installed: skills } = await api.teamSkillsGithubInstall(
        teamId,
        { source: from.source, commitSha: from.commitSha, names: selected },
        scope,
      )

      // The backend installs every picked skill or none, so each row here is installed.
      setInstalled({
        from: previewSourceLabel(from),
        results: skills.map((skill) => ({
          id: skill.name,
          name: skill.name,
          status: 'imported',
          detail: `${t('{count} files', { count: String(skill.fileCount) })} · ${formatBytes(skill.totalBytes)}`,
        })),
      })
      if (skills[0]) onInstalled(skills[0].name)
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
          <div className="flex items-center justify-end gap-2 px-5 py-4">
            {pending && <Loader2 className="mr-auto h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
            {installed ? (
              <Button type="button" size="sm" onClick={close}>
                {t('Done')}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={close}
                >
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
              </>
            )}
          </div>
        }
      >
        <div className="px-5 py-4">
          {installed ? (
            <>
              <div className="mb-2 text-[11px] text-tertiary">{installed.from}</div>
              <SkillImportResults results={installed.results} />
            </>
          ) : (
            <GithubSourceStep
              source={source}
              pending={pending}
              preview={preview}
              selected={selected}
              onSource={(value) => {
                setSource(value)
                reset()
              }}
              onFind={() => void find()}
              onChoose={(next) => preview && choose(preview, next)}
            />
          )}
          {error && (
            <div className="mt-2 rounded-md border border-error/25 bg-error/10 px-2.5 py-2 text-[12px] text-error">
              {error}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
