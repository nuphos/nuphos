import { Laptop, Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../../api'
import { AppAlertDialog } from '../../components/ui/alert-dialog'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import type { LocalSkillInfo, SkillScope } from '../../api'

const SOURCE_LABELS: Record<LocalSkillInfo['source'], string> = {
  claude: 'Claude Code',
  codex: 'Codex',
}

/** Pick a skill in `~/.claude/skills` (or the Codex folder) on this computer,
 *  review the files it would send, then upload them into the store being viewed,
 *  under `skills/<name>/`. */
export function LocalSkillImportMenu({
  teamId,
  scope,
  disabled,
  onImported,
}: {
  teamId: string
  scope: SkillScope
  disabled: boolean
  onImported: (name: string) => void
}) {
  const [skills, setSkills] = useState<LocalSkillInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  // Kept after closing so the dialog does not empty out while it animates away.
  const [reviewing, setReviewing] = useState<LocalSkillInfo | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api
      .teamSkillsListLocal()
      .then(setSkills)
      .catch((err: unknown) => {
        setSkills([])
        toast.apiError(t('Could not read this computer’s skills'), err)
      })
      .finally(() => setLoading(false))
  }, [])

  // Main uploads only the files reviewed here, so a failure stays in the dialog.
  const importSkill = useCallback(
    async (skill: LocalSkillInfo) => {
      const result = await api.teamSkillsImportLocal(teamId, skill.id, scope, skill.files)
      const files =
        result.keys.length === 1
          ? t('{count} file', { count: '1' })
          : t('{count} files', { count: String(result.keys.length) })

      toast.success(
        t('Imported {name}', { name: result.name }),
        result.skipped.length > 0
          ? t('{files} · skipped {names} (too large)', {
              files,
              names: result.skipped.join(', '),
            })
          : files,
      )
      onImported(result.name)
    },
    [onImported, scope, teamId],
  )

  return (
    <>
      <Menu
        onOpenChange={(open) => {
          if (open) load()
        }}
      >
        <MenuTrigger
          disabled={disabled}
          className="h-7 px-2 flex items-center gap-1.5 rounded-md text-[12px] text-secondary hover:text-main hover:bg-state-hover data-[popup-open]:bg-state-selected disabled:text-tertiary"
          title={t('Import a skill from this computer')}
        >
          <Laptop className="w-3.5 h-3.5" strokeWidth={2} />
          <span>{t('Import from this computer')}</span>
        </MenuTrigger>
        <MenuContent align="end" className="w-[320px]">
          <div className="h-8 px-2 flex items-center gap-2 text-[12px] text-tertiary">
            <span className="truncate">{t('Skills on this computer')}</span>
            {loading && <Loader2 className="ml-auto w-3.5 h-3.5 animate-spin" strokeWidth={2} />}
          </div>
          {loading && !skills ? (
            <div className="px-2 py-2 text-[12px] text-tertiary">{t('Loading...')}</div>
          ) : !skills || skills.length === 0 ? (
            <div className="px-2 py-2 text-[12px] text-tertiary">
              {t('No skills found in ~/.claude/skills or ~/.agents/skills')}
            </div>
          ) : (
            <div className="max-h-72 overflow-auto scrollbar-thin">
              {skills.map((skill) => (
                <MenuItem
                  key={skill.id}
                  onClick={() => {
                    setReviewing(skill)
                    setReviewOpen(true)
                  }}
                  title={skill.linkedTo ? `${skill.path} → ${skill.linkedTo}` : skill.path}
                >
                  <span className="flex w-full min-w-0 flex-col">
                    <span className="w-full truncate text-[12.5px]">{skill.name}</span>
                    <span className="w-full truncate text-[11px] text-tertiary">
                      {SOURCE_LABELS[skill.source]} ·{' '}
                      {skill.fileCount === 1
                        ? t('{count} file', { count: '1' })
                        : t('{count} files', { count: String(skill.fileCount) })}
                      {skill.description ? ` · ${skill.description}` : ''}
                    </span>
                    {skill.linkedTo && (
                      <span className="w-full truncate text-[11px] text-tertiary">
                        → {skill.linkedTo}
                      </span>
                    )}
                  </span>
                </MenuItem>
              ))}
            </div>
          )}
        </MenuContent>
      </Menu>
      <AppAlertDialog
        open={reviewOpen}
        title={t('Import {name}?', { name: reviewing?.name ?? '' })}
        description={reviewing && <ImportReview skill={reviewing} />}
        confirmLabel={t('Import')}
        onConfirm={() => (reviewing ? importSkill(reviewing) : undefined)}
        onClose={() => setReviewOpen(false)}
      />
    </>
  )
}

/** Every file the import sends; one reached through a link out of the skill shows where it really is. */
function ImportReview({ skill }: { skill: LocalSkillInfo }) {
  const outside = skill.files.some((file) => file.outside)

  return (
    <span className="block">
      <span className="block">{t('These files will be uploaded from this computer:')}</span>
      <span className="mt-2 block max-h-56 overflow-auto rounded-md border border-line-control px-2 py-1.5 font-mono text-[11.5px] scrollbar-thin">
        {skill.files.map((file) => (
          <span key={file.relPath} className="block truncate" title={file.realPath}>
            {file.relPath}
            {file.outside && <span className="text-warning"> → {file.realPath}</span>}
          </span>
        ))}
      </span>
      {outside && (
        <span className="mt-2 block text-warning">
          {t(
            'Files with → come from outside this skill’s folder, at the path shown. Make sure you mean to share them.',
          )}
        </span>
      )}
    </span>
  )
}
