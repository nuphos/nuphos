import { useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { homeOf, shortPath } from './localSetupPaths'

import type { LocalSetupStatus } from '../../api'

function skillCount(count: number): string {
  return count === 1 ? t('1 skill') : t('{n} skills', { n: count.toLocaleString() })
}

/**
 * The folders Sync my setup reads skills from, in order: ~/.claude/skills, then
 * Codex's or any the member adds. Sync only reads them; a name in two folders
 * syncs from the one listed first.
 */
export function LocalSetupFolders({
  teamId,
  status,
  onChanged,
}: {
  teamId: string | undefined
  status: LocalSetupStatus
  onChanged: () => void
}) {
  const [saving, setSaving] = useState(false)
  const home = homeOf(status.folders)
  const added = status.folders.slice(1).map((folder) => folder.path)

  async function save(folders: string[]) {
    if (!teamId) return
    setSaving(true)
    try {
      await api.localSetupSetFolders(teamId, folders)
    } catch (err) {
      toast.apiError(t('Could not change the skill folders'), err)
    } finally {
      setSaving(false)
      onChanged()
    }
  }

  async function addFolder() {
    const [picked] = await api.selectLocalFolder()

    if (picked) await save([...added, picked])
  }

  return (
    <div className="space-y-2 text-[13px] text-secondary">
      <ul className="space-y-1">
        {status.folders.map((folder, index) => (
          <li key={folder.path} className="flex items-center gap-2">
            <span className="min-w-0 truncate font-mono text-[12px] text-main" title={folder.path}>
              {shortPath(folder.path, home)}
            </span>
            <span className="shrink-0 text-[12px] text-tertiary">{skillCount(folder.skills)}</span>
            {index > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                disabled={saving}
                onClick={() => void save(added.filter((path) => path !== folder.path))}
              >
                {t('Remove')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        {!added.includes(status.codexFolder) && (
          <Button
            size="sm"
            variant="secondary"
            disabled={saving}
            onClick={() => void save([...added, status.codexFolder])}
          >
            {t('Add Codex skills')}
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => void addFolder()}>
          {t('Add folder…')}
        </Button>
      </div>
      <p className="text-[12px] text-tertiary">
        {t(
          'Nuphos only reads these folders. A skill name found in two of them syncs from the one listed first.',
        )}
      </p>
    </div>
  )
}
