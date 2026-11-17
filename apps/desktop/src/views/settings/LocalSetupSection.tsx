import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { LocalSetupFolders } from './LocalSetupFolders'
import { LocalSetupLinkedSkills } from './LocalSetupLinkedSkills'
import { homeOf, shortPath } from './localSetupPaths'
import { LoadFailed, SectionHeader } from './shared'

import type { LocalSetupResult, LocalSetupStatus } from '../../api'
import type { AtlasTeam } from '../../types'

type Skipped = LocalSetupResult['skipped'][number]

const SKIP_REASON: Record<Exclude<Skipped['reason'], 'name_clash'>, string> = {
  too_large: t('larger than 4 MB'),
  too_many_files: t('too many files or links to read in full'),
  name_taken: t('a personal skill with this name already exists'),
  over_budget: t('over the runtime’s skill budget'),
  unreadable: t('some of its files could not be read'),
  needs_review: t('it links outside its folder and waits for your review'),
}

/** Why a skill stayed here; a name in two folders says which copy is in Nuphos. */
function skipReason(skill: Skipped, home: string): string {
  if (skill.reason !== 'name_clash') return SKIP_REASON[skill.reason]

  return t('the copy in {folder} is not synced: {first} comes first and has one too', {
    folder: shortPath(skill.folder ?? '', home),
    first: shortPath(skill.syncedFrom ?? '', home),
  })
}

function skillCount(count: number): string {
  return count === 1 ? t('1 skill') : t('{n} skills', { n: count.toLocaleString() })
}

function fileCount(count: number): string {
  return count === 1 ? t('1 file') : t('{n} files', { n: count.toLocaleString() })
}

function instructionCount(count: number): string {
  return count === 1
    ? t('1 personal instruction')
    : t('{n} personal instructions', { n: count.toLocaleString() })
}

function instructionLine(last: LocalSetupResult, chars: number | null): string {
  switch (last.instruction) {
    case 'synced':
      return t('CLAUDE.md synced as {count}.', { count: instructionCount(last.instructionParts) })
    case 'too_long':
      return t(
        'CLAUDE.md ({n} characters) does not fit in your personal instructions’ limit, so it was not synced.',
        { n: (chars ?? 0).toLocaleString() },
      )
    case 'removed':
      return t('CLAUDE.md is gone from this computer, so its personal instructions were removed.')
    case 'none':
      return t('No CLAUDE.md on this computer.')
  }
}

function LastSync({
  last,
  claudeMdChars,
  home,
}: {
  last: LocalSetupResult
  claudeMdChars: number | null
  home: string
}) {
  return (
    <div className="space-y-2 text-[13px] text-secondary" role="status">
      <p>
        {last.removedSkills > 0
          ? t('Last synced {date}: {skills} in Nuphos, {files} uploaded, {removed} removed.', {
              date: new Date(last.at).toLocaleString(),
              skills: skillCount(last.syncedSkills),
              files: fileCount(last.uploadedFiles),
              removed: skillCount(last.removedSkills),
            })
          : t('Last synced {date}: {skills} in Nuphos, {files} uploaded.', {
              date: new Date(last.at).toLocaleString(),
              skills: skillCount(last.syncedSkills),
              files: fileCount(last.uploadedFiles),
            })}
      </p>
      <p>{instructionLine(last, claudeMdChars)}</p>
      {last.failed.length > 0 && (
        <p>
          {t('Nuphos refused {skills}; they stay on this computer.', {
            skills: last.failed.join(', '),
          })}
        </p>
      )}
      {last.skipped.length > 0 && (
        <details>
          <summary className="cursor-pointer text-tertiary">
            {t('{skills} left on this computer', { skills: skillCount(last.skipped.length) })}
          </summary>
          <ul className="mt-2 max-h-60 space-y-0.5 overflow-auto text-[12px] text-tertiary">
            {last.skipped.map((skill) => (
              <li key={`${skill.name}\0${skill.folder ?? ''}`}>
                <span className="font-mono text-secondary">{skill.name}</span> —{' '}
                {skipReason(skill, home)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** Settings → My preferences → Sync my setup. */
export function LocalSetupSection({ team }: { team: AtlasTeam | undefined }) {
  const teamId = team?.id
  const [status, setStatus] = useState<LocalSetupStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async () => {
    if (!teamId) return
    try {
      setStatus(await api.localSetupStatus(teamId))
      setFailed(false)
    } catch (err) {
      setFailed(true)
      toast.apiError(t('Could not read this computer’s setup'), err)
    }
  }, [teamId])

  useEffect(() => {
    if (!teamId) return
    let cancelled = false

    void api
      .localSetupStatus(teamId)
      .then((result) => {
        if (!cancelled) setStatus(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setFailed(true)
        toast.apiError(t('Could not read this computer’s setup'), err)
      })

    return () => {
      cancelled = true
    }
  }, [teamId])

  async function syncNow() {
    if (!teamId) return
    setSyncing(true)
    try {
      const result = await api.localSetupSync(teamId)

      toast.success(
        t('Setup synced'),
        t('{skills} in Nuphos, {files} uploaded.', {
          skills: skillCount(result.syncedSkills),
          files: fileCount(result.uploadedFiles),
        }),
      )
    } catch (err) {
      toast.apiError(t('Could not sync your setup'), err)
    } finally {
      setSyncing(false)
      void refresh()
    }
  }

  async function setAutoSync(enabled: boolean) {
    if (!teamId) return
    try {
      await api.localSetupSetAutoSync(teamId, enabled)
      setStatus((current) => current && { ...current, autoSync: enabled })
    } catch (err) {
      toast.apiError(t('Could not change automatic sync'), err)
    }
  }

  const last = status?.last ?? null
  const busy = syncing || status?.running === true

  return (
    <div>
      <SectionHeader
        title={t('Sync my setup')}
        description={t(
          'Bring this computer’s skill folders and ~/.claude/CLAUDE.md into {team} as your personal skills and instructions, so every agent you run here starts with the same context as your own CLI. Only your agents get them.',
          { team: team?.name ?? t('this team') },
        )}
      />

      {!status &&
        (failed ? (
          <LoadFailed
            message={t('Couldn’t read this computer’s setup.')}
            onRetry={() => void refresh()}
          />
        ) : (
          <div aria-busy="true" className="h-16 animate-pulse rounded-lg bg-state-selected" />
        ))}
      {status && (
        <div className="space-y-5">
          <div className="rounded-lg border border-line-control px-4 py-3 text-[13px] text-secondary">
            <LocalSetupFolders teamId={teamId} status={status} onChanged={() => void refresh()} />
            <p className="mt-3 text-main">
              {status.claudeMdChars === null
                ? t('No CLAUDE.md on this computer.')
                : t('A CLAUDE.md of {n} characters.', {
                    n: status.claudeMdChars.toLocaleString(),
                  })}
            </p>
            <p className="mt-1 text-[12px] text-tertiary">
              {t(
                'A runtime loads at most {files} files and {mb} MB of personal skills, so the smallest skills go first and the rest stay on this computer. Edit synced skills in their folder: the next sync overwrites changes made in Nuphos.',
                {
                  files: status.budget.files.toLocaleString(),
                  mb: Math.round(status.budget.bytes / 1024 / 1024),
                },
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" disabled={busy || !teamId} onClick={() => void syncNow()}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy ? t('Syncing…') : t('Sync now')}
            </Button>
            <div className="flex items-center gap-2 text-[13px] text-secondary">
              <Switch
                checked={status.autoSync}
                onChange={(next) => void setAutoSync(next)}
                disabled={!teamId}
                label={t('Keep in sync')}
              />
              {t('Keep in sync while Nuphos is open')}
            </div>
          </div>

          {teamId && (
            <LocalSetupLinkedSkills
              teamId={teamId}
              skills={status.linkedSkills}
              onApproved={() => void refresh()}
            />
          )}

          {last && (
            <LastSync
              last={last}
              claudeMdChars={status.claudeMdChars}
              home={homeOf(status.folders)}
            />
          )}
        </div>
      )}
    </div>
  )
}
