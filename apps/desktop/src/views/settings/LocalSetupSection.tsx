import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'

import { SectionHeader } from './shared'

import type { LocalSetupResult, LocalSetupStatus } from '../../api'
import type { AtlasTeam } from '../../types'

const SKIP_REASON: Record<LocalSetupResult['skipped'][number]['reason'], string> = {
  too_large: 'larger than 4 MB',
  too_many_files: '200 files or more',
  name_taken: 'a personal skill with this name already exists',
  over_budget: 'over the runtime’s skill budget',
  unreadable: 'its SKILL.md links outside ~/.claude/skills',
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`
}

function instructionLine(last: LocalSetupResult, chars: number | null): string {
  switch (last.instruction) {
    case 'synced':
      return `CLAUDE.md synced as ${plural(last.instructionParts, 'personal instruction')}.`
    case 'too_long':
      return `CLAUDE.md (${(chars ?? 0).toLocaleString()} characters) does not fit in your personal instructions’ limit, so it was not synced.`
    case 'removed':
      return 'CLAUDE.md is gone from this computer, so its personal instructions were removed.'
    case 'none':
      return 'No CLAUDE.md on this computer.'
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
        Last synced {new Date(last.at).toLocaleString()}: {plural(last.syncedSkills, 'skill')} in
        Nuphos, {plural(last.uploadedFiles, 'file')} uploaded
        {last.removedSkills > 0 ? `, ${plural(last.removedSkills, 'skill')} removed` : ''}.
      </p>
      <p>{instructionLine(last, claudeMdChars)}</p>
      {last.failed.length > 0 && (
        <p>Nuphos refused {last.failed.join(', ')}; they stay on this computer.</p>
      )}
      {last.skipped.length > 0 && (
        <details>
          <summary className="cursor-pointer text-tertiary">
            {plural(last.skipped.length, 'skill')} left on this computer
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
      toast.apiError('Could not read this computer’s setup', err)
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
        toast.apiError('Could not read this computer’s setup', err)
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
        'Setup synced',
        `${plural(result.syncedSkills, 'skill')} in Nuphos, ${plural(result.uploadedFiles, 'file')} uploaded.`,
      )
    } catch (err) {
      toast.apiError('Could not sync your setup', err)
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
      toast.apiError('Could not change automatic sync', err)
    }
  }

  const last = status?.last ?? null
  const busy = syncing || status?.running === true

  return (
    <div>
      <SectionHeader
        title="Sync my setup"
        description={`Bring this computer’s Claude Code skills and ~/.claude/CLAUDE.md into ${team?.name ?? 'this team'} as your personal skills and instructions, so every agent you run here starts with the same context as your own CLI. Only your agents get them.`}
      />

      {status && (
        <div className="space-y-5">
          <div className="rounded-lg border border-zGray-800 px-4 py-3 text-[13px] text-secondary">
            <p className="text-main">
              Found {plural(status.localSkills, 'skill')} in ~/.claude/skills
              {status.claudeMdChars === null
                ? ' and no CLAUDE.md.'
                : ` and a CLAUDE.md of ${status.claudeMdChars.toLocaleString()} characters.`}
            </p>
            <p className="mt-1 text-[12px] text-tertiary">
              A runtime loads at most {status.budget.files.toLocaleString()} files and{' '}
              {Math.round(status.budget.bytes / 1024 / 1024)} MB of personal skills, so the smallest
              skills go first and the rest stay on this computer. Edits to synced skills belong
              here: the next sync overwrites changes made in Nuphos.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" disabled={busy || !teamId} onClick={() => void syncNow()}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy ? 'Syncing…' : 'Sync now'}
            </Button>
            <div className="flex items-center gap-2 text-[13px] text-secondary">
              <Switch
                checked={status.autoSync}
                onChange={(next) => void setAutoSync(next)}
                disabled={!teamId}
                label="Keep in sync"
              />
              Keep in sync while Nuphos is open
            </div>
          </div>

          {last && <LastSync last={last} claudeMdChars={status.claudeMdChars} />}
        </div>
      )}
    </div>
  )
}
