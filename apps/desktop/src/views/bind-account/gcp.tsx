import clsx from 'clsx'

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
  firstRun,
  wif,
  saEmail,
  onSaEmailChange,
  projectId,
  onProjectIdChange,
}: {
  step: number
  purpose: 'operational'
  firstRun: boolean
  /** Nuphos's principal for the Token Creator grant; null until it loads. */
  wif: GcpWifInfo | null
  saEmail: string
  onSaEmailChange: (v: string) => void
  projectId: string
  onProjectIdChange: (v: string) => void
}) {
  const steps = gcpSteps(purpose, firstRun)

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
          Step {step + 1} of {steps.length} · Cloud Console
        </div>
        <div className="text-[13.5px] text-main font-medium">{steps[step]}</div>
      </div>
      <GcpWizardStepContent
        step={step}
        purpose={purpose}
        firstRun={firstRun}
        wif={wif}
        saEmail={saEmail}
        onSaEmailChange={onSaEmailChange}
        projectId={projectId}
        onProjectIdChange={onProjectIdChange}
      />
    </div>
  )
}
