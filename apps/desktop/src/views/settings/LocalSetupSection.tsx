import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { SectionHeader } from './shared'

import type { LocalSetupResult, LocalSetupStatus } from '../../api'
import type { AtlasTeam } from '../../types'

const SKIP_REASON: Record<LocalSetupResult['skipped'][number]['reason'], string> = {
  too_large: t('larger than 4 MB'),
  too_many_files: t('200 files or more'),
  name_taken: t('a personal skill with this name already exists'),
  over_budget: t('over the runtime’s skill budget'),
  unreadable: t('its SKILL.md links outside ~/.claude/skills'),
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
}: {
  last: LocalSetupResult
  claudeMdChars: number | null
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
              <li key={skill.name}>
                <span className="font-mono text-secondary">{skill.name}</span> —{' '}
                {SKIP_REASON[skill.reason]}
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

  const refresh = useCallback(async () => {
    if (!teamId) return
    try {
      setStatus(await api.localSetupStatus(teamId))
    } catch (err) {
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
          'Bring this computer’s Claude Code skills and ~/.claude/CLAUDE.md into {team} as your personal skills and instructions, so every agent you run here starts with the same context as your own CLI. Only your agents get them.',
          { team: team?.name ?? t('this team') },
        )}
      />

      {status && (
        <div className="space-y-5">
          <div className="rounded-lg border border-zGray-800 px-4 py-3 text-[13px] text-secondary">
            <p className="text-main">
              {status.claudeMdChars === null
                ? t('Found {skills} in ~/.claude/skills and no CLAUDE.md.', {
                    skills: skillCount(status.localSkills),
                  })
                : t('Found {skills} in ~/.claude/skills and a CLAUDE.md of {n} characters.', {
                    skills: skillCount(status.localSkills),
                    n: status.claudeMdChars.toLocaleString(),
                  })}
            </p>
            <p className="mt-1 text-[12px] text-tertiary">
              {t(
                'A runtime loads at most {files} files and {mb} MB of personal skills, so the smallest skills go first and the rest stay on this computer. Edits to synced skills belong here: the next sync overwrites changes made in Nuphos.',
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

          {last && <LastSync last={last} claudeMdChars={status.claudeMdChars} />}
        </div>
      )}
    </div>
  )
}
