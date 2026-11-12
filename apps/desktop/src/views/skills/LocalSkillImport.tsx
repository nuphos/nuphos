import { Laptop, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { SkillsFilesReview } from './SkillFilesReview'
import { SkillImportResults } from './SkillImportResults'
import { SkillPicker } from './SkillPicker'

import type { SkillImportResult } from './SkillImportResults'
import type { LocalSkillImportOutcome, LocalSkillInfo, SkillScope } from '../../api'

const SOURCE_LABELS: Record<LocalSkillInfo['source'], string> = {
  claude: 'Claude Code',
  codex: 'Codex',
}

function fileCount(count: number): string {
  return count === 1
    ? t('{count} file', { count: '1' })
    : t('{count} files', { count: String(count) })
}

function outcomeDetail(outcome: LocalSkillImportOutcome): string {
  if (outcome.status === 'imported') {
    const files = fileCount(outcome.keys.length)

    return outcome.tooLarge.length > 0
      ? t('{files} · skipped {names} (too large)', { files, names: outcome.tooLarge.join(', ') })
      : files
  }
  switch (outcome.reason) {
    case 'name_taken':
      return t('a skill with this name is already in this store')
    case 'builtin':
      return t('this name belongs to a built-in skill')
    case 'changed':
      return t('it changed since you reviewed it; import it again to review the new files')
    case 'missing':
      return t('it is no longer on this computer')
    case 'error':
    case undefined:
      return outcome.message ?? t('Failed')
  }
}

function toImportResult(outcome: LocalSkillImportOutcome): SkillImportResult {
  return {
    id: outcome.id,
    name: outcome.name,
    status: outcome.status,
    detail: outcomeDetail(outcome),
  }
}

type Step = 'pick' | 'review' | 'results'

function PickStep({
  skills,
  selected,
  onChange,
}: {
  skills: LocalSkillInfo[] | null
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  if (skills === null) return <p className="text-[12px] text-tertiary">{t('Loading...')}</p>
  if (skills.length === 0) {
    return (
      <p className="text-[12px] text-tertiary">
        {t('No skills found in ~/.claude/skills or ~/.agents/skills')}
      </p>
    )
  }

  return (
    <SkillPicker
      items={skills.map((skill) => ({
        id: skill.id,
        title: skill.name,
        subtitle: [SOURCE_LABELS[skill.source], fileCount(skill.fileCount), skill.description]
          .filter(Boolean)
          .join(' · '),
        detail: skill.linkedTo ? `→ ${skill.linkedTo}` : undefined,
      }))}
      selected={selected}
      onChange={onChange}
    />
  )
}

function StepFooter({
  step,
  picked,
  importing,
  onStep,
  onImport,
  onClose,
}: {
  step: Step
  picked: number
  importing: boolean
  onStep: (step: Step) => void
  onImport: () => void
  onClose: () => void
}) {
  if (step === 'results') {
    return (
      <Button size="sm" onClick={onClose}>
        {t('Done')}
      </Button>
    )
  }
  if (step === 'review') {
    return (
      <>
        <Button size="sm" variant="secondary" disabled={importing} onClick={() => onStep('pick')}>
          {t('Back')}
        </Button>
        <Button size="sm" disabled={importing} onClick={onImport}>
          {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('Import')}
        </Button>
      </>
    )
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={onClose}>
        {t('Cancel')}
      </Button>
      <Button size="sm" disabled={picked === 0} onClick={() => onStep('review')}>
        {t('Review')}
      </Button>
    </>
  )
}

/**
 * Import from this computer: pick any of the skills in `~/.claude/skills` or the
 * Codex folder, review every file they would send in one list, then upload them
 * into the store being viewed with a result per skill.
 */
export function LocalSkillImport({
  teamId,
  scope,
  disabled,
  onImported,
}: {
  teamId: string
  scope: SkillScope
  disabled: boolean
  onImported: (names: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('pick')
  const [skills, setSkills] = useState<LocalSkillInfo[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<SkillImportResult[]>([])
  const picked = (skills ?? []).filter((skill) => selected.has(skill.id))

  function start() {
    setOpen(true)
    setStep('pick')
    setSelected(new Set())
    setSkills(null)
    api
      .teamSkillsListLocal()
      .then(setSkills)
      .catch((err: unknown) => {
        setSkills([])
        toast.apiError(t('Could not read this computer’s skills'), err)
      })
  }

  async function importPicked() {
    setImporting(true)
    try {
      const outcomes = await api.teamSkillsImportLocal(
        teamId,
        scope,
        picked.map((skill) => ({ id: skill.id, reviewed: skill.files })),
      )
      const imported = outcomes.filter((outcome) => outcome.status === 'imported')

      setResults(outcomes.map(toImportResult))
      setStep('results')
      if (imported.length > 0) onImported(imported.map((outcome) => outcome.name))
    } catch (err) {
      toast.apiError(t('Could not import skills'), err)
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={start}
        className="h-7 px-2 flex items-center gap-1.5 rounded-md text-[12px] text-secondary hover:text-main hover:bg-state-hover disabled:text-tertiary"
        title={t('Import skills from this computer')}
      >
        <Laptop className="w-3.5 h-3.5" strokeWidth={2} />
        <span>{t('Import from this computer')}</span>
      </button>
      <Modal
        open={open}
        onClose={() => {
          if (!importing) setOpen(false)
        }}
        title={t('Import from this computer')}
        description={step === 'pick' ? t('Skills on this computer') : undefined}
        footer={
          <div className="flex items-center justify-end gap-2 px-5 py-4">
            <StepFooter
              step={step}
              picked={picked.length}
              importing={importing}
              onStep={setStep}
              onImport={() => void importPicked()}
              onClose={() => setOpen(false)}
            />
          </div>
        }
        width={560}
        closeOnBackdrop={false}
      >
        <div className="px-5 py-4">
          {step === 'pick' && (
            <PickStep skills={skills} selected={selected} onChange={setSelected} />
          )}
          {step === 'review' && <SkillsFilesReview skills={picked} />}
          {step === 'results' && <SkillImportResults results={results} />}
        </div>
      </Modal>
    </>
  )
}
