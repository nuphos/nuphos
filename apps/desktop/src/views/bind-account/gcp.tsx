import clsx from 'clsx'

import { t } from '../../i18n'
import { gcpSteps } from '../../lib/cloudBindSteps'

import { GcpWizardStepContent } from './gcp-steps'

import type { GcpWifInfo } from '../../types'

// ---------------------------------------------------------------------------
// GCP bind wizard — one step per page, mirroring the AWS wizard. Each step
// shows the console clicks to perform.
// ---------------------------------------------------------------------------

export function GcpBindWizard({
  step,
  purpose,
  wif,
  saEmail,
  onSaEmailChange,
  projectId,
  onProjectIdChange,
}: {
  step: number
  purpose: 'operational'
  /** Nuphos's principal for the Token Creator grant; null until it loads. */
  wif: GcpWifInfo | null
  saEmail: string
  onSaEmailChange: (v: string) => void
  projectId: string
  onProjectIdChange: (v: string) => void
}) {
  const steps = gcpSteps(purpose)

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-1 mb-2">
          {steps.map((title, i) => (
            <div
              key={title}
              className={clsx(
                'h-1 flex-1 rounded-full transition-colors',
                i <= step ? 'bg-zViolet-500' : 'bg-zGray-800',
              )}
            />
          ))}
        </div>
        <div className="text-[11px] text-tertiary uppercase tracking-wider">
          {t('Step {n} of {total} · Cloud Console', { n: step + 1, total: steps.length })}
        </div>
        <div className="text-[13.5px] text-main font-medium">{steps[step]}</div>
      </div>
      <GcpWizardStepContent
        step={step}
        purpose={purpose}
        wif={wif}
        saEmail={saEmail}
        onSaEmailChange={onSaEmailChange}
        projectId={projectId}
        onProjectIdChange={onProjectIdChange}
      />
    </div>
  )
}
