import { useState } from 'react'

import { api } from '../../api'
import { AppAlertDialog } from '../../components/ui/alert-dialog'
import { Button } from '../../components/ui/button'
import { t } from '../../i18n'
import { SkillFilesReview } from '../skills/SkillFilesReview'

import type { LocalSetupStatus } from '../../api'

type LinkedSkill = LocalSetupStatus['linkedSkills'][number]

/**
 * Skills that link outside their own folder. Sync never reads one until the
 * member has reviewed exactly where its links lead, here or in the Import review,
 * because automatic sync has no confirm step of its own.
 */
export function LocalSetupLinkedSkills({
  teamId,
  skills,
  onApproved,
}: {
  teamId: string
  skills: LinkedSkill[]
  onApproved: () => void
}) {
  // Kept after closing so the dialog does not empty out while it animates away.
  const [reviewing, setReviewing] = useState<LinkedSkill | null>(null)
  const [open, setOpen] = useState(false)

  if (skills.length === 0) return null

  return (
    <div className="space-y-1 text-[13px] text-secondary">
      <p className="text-warning">{t('These skills link to files outside their own folder:')}</p>
      <ul className="space-y-1">
        {skills.map((skill) => (
          <li key={skill.name} className="flex items-center gap-2">
            <span className="min-w-0 truncate font-mono text-[12px]">{skill.name}</span>
            <span className="text-[12px] text-tertiary">
              {skill.reviewed ? t('reviewed, synced') : t('not synced until you review it')}
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              onClick={() => {
                setReviewing(skill)
                setOpen(true)
              }}
            >
              {t('Review')}
            </Button>
          </li>
        ))}
      </ul>
      <AppAlertDialog
        open={open}
        title={t('Sync {name}?', { name: reviewing?.name ?? '' })}
        description={reviewing && <SkillFilesReview files={reviewing.files} />}
        confirmLabel={t('Allow and sync')}
        onConfirm={async () => {
          if (!reviewing) return
          await api.localSetupApproveLinks(teamId, reviewing.name, reviewing.files)
          onApproved()
        }}
        onClose={() => setOpen(false)}
      />
    </div>
  )
}
