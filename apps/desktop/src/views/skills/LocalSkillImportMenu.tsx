import { Laptop, Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../../api'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'

import type { LocalSkillInfo } from '../../api'

const SOURCE_LABELS: Record<LocalSkillInfo['source'], string> = {
  claude: 'Claude Code',
  codex: 'Codex',
}

/** One click per skill: read `~/.claude/skills/<name>` (or the Codex folder) on
 *  this computer and upload it into the team store under `skills/<name>/`. */
export function LocalSkillImportMenu({
  teamId,
  disabled,
  onImported,
}: {
  teamId: string
  disabled: boolean
  onImported: (name: string) => void
}) {
  const [skills, setSkills] = useState<LocalSkillInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api
      .teamSkillsListLocal()
      .then(setSkills)
      .catch((err: unknown) => {
        setSkills([])
        toast.apiError('Could not read this computer’s skills', err)
      })
      .finally(() => setLoading(false))
  }, [])

  const importSkill = useCallback(
    (skill: LocalSkillInfo) => {
      setImporting(skill.id)
      api
        .teamSkillsImportLocal(teamId, skill.id)
        .then((result) => {
          const files = `${String(result.keys.length)} file${result.keys.length === 1 ? '' : 's'}`

          toast.success(
            `Imported ${result.name}`,
            result.skipped.length > 0
              ? `${files} · skipped ${result.skipped.join(', ')} (too large)`
              : files,
          )
          onImported(result.name)
        })
        .catch((err: unknown) => {
          toast.apiError(`Could not import ${skill.name}`, err)
        })
        .finally(() => setImporting(null))
    },
    [onImported, teamId],
  )

  return (
    <Menu
      onOpenChange={(open) => {
        if (open) load()
      }}
    >
      <MenuTrigger
        disabled={disabled}
        className="h-7 px-2 flex items-center gap-1.5 rounded-md text-[12px] text-secondary hover:text-main hover:bg-zGray-800/60 data-[popup-open]:bg-zGray-800/60 disabled:text-tertiary"
        title="Import a skill from this computer"
      >
        <Laptop className="w-3.5 h-3.5" strokeWidth={2} />
        <span>Import from this computer</span>
      </MenuTrigger>
      <MenuContent align="end" className="w-[320px]">
        <div className="h-8 px-2 flex items-center gap-2 text-[12px] text-tertiary">
          <span className="truncate">Skills on this computer</span>
          {loading && <Loader2 className="ml-auto w-3.5 h-3.5 animate-spin" strokeWidth={2} />}
        </div>
        {loading && !skills ? (
          <div className="px-2 py-2 text-[12px] text-tertiary">Loading...</div>
        ) : !skills || skills.length === 0 ? (
          <div className="px-2 py-2 text-[12px] text-tertiary">
            No skills found in ~/.claude/skills or ~/.agents/skills
          </div>
        ) : (
          <div className="max-h-72 overflow-auto scrollbar-thin">
            {skills.map((skill) => (
              <MenuItem
                key={skill.id}
                closeOnClick={false}
                onClick={() => importSkill(skill)}
                title={skill.path}
              >
                <span className="flex w-full min-w-0 flex-col">
                  <span className="w-full truncate text-[12.5px]">
                    {skill.name}
                    {importing === skill.id && ' · importing...'}
                  </span>
                  <span className="w-full truncate text-[11px] text-tertiary">
                    {SOURCE_LABELS[skill.source]} · {skill.fileCount} file
                    {skill.fileCount === 1 ? '' : 's'}
                    {skill.description ? ` · ${skill.description}` : ''}
                  </span>
                </span>
              </MenuItem>
            ))}
          </div>
        )}
      </MenuContent>
    </Menu>
  )
}
