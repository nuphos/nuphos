import clsx from 'clsx'

import { awsContentStep, awsSteps } from '../../lib/cloudBindSteps'

import { AwsWizardStepContent } from './aws-steps'

// ---------------------------------------------------------------------------
// AWS bind wizard — one console step per page. The sub condition entered in
// step 2 pins the role to this team; it is the security boundary that stops
// any other Nuphos team from assuming the role.
// ---------------------------------------------------------------------------

export function AwsBindWizard({
  step,
  teamId,
  roleArn,
  onRoleArnChange,
  purpose,
  firstRun,
}: {
  step: number
  teamId: string
  roleArn: string
  onRoleArnChange: (v: string) => void
  purpose: 'operational'
  firstRun: boolean
}) {
  const steps = awsSteps(purpose)

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
          Step {step + 1} of {steps.length}
        </div>
        <div className="text-[13.5px] text-main font-medium">{steps[step]}</div>
      </div>

      <div className="t-page-slide t-wizard-slide" data-page={step + 1}>
        {steps.map((title, i) => (
          <section
            key={title}
            className="t-page"
            data-page-id={i + 1}
            style={
              i === step
                ? undefined
                : ({
                    '--t-page-from-x':
                      i < step
                        ? 'calc(var(--page-slide-distance) * -1)'
                        : 'var(--page-slide-distance)',
                  } as React.CSSProperties)
            }
          >
            <AwsWizardStepContent
              step={awsContentStep(purpose, i)}
              teamId={teamId}
              roleArn={roleArn}
              onRoleArnChange={onRoleArnChange}
              purpose={purpose}
              firstRun={firstRun}
            />
          </section>
        ))}
      </div>
    </div>
  )
}
