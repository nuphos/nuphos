import clsx from 'clsx'

import { azureSteps } from '../../lib/cloudBindSteps'

import { AzureWizardStepContent } from './azure-steps'

import type { AzureOidcInfo } from '../../types'

export function AzureBindWizard({
  step,
  oidc,
  purpose,
  firstRun,
  label,
  onLabelChange,
  tenantId,
  onTenantIdChange,
  clientId,
  onClientIdChange,
  subscriptionId,
  onSubscriptionIdChange,
}: {
  step: number
  oidc: AzureOidcInfo | null
  purpose: 'operational'
  firstRun: boolean
  label: string
  onLabelChange: (v: string) => void
  tenantId: string
  onTenantIdChange: (v: string) => void
  clientId: string
  onClientIdChange: (v: string) => void
  subscriptionId: string
  onSubscriptionIdChange: (v: string) => void
}) {
  const steps = azureSteps(purpose)

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
            <AzureWizardStepContent
              step={i}
              oidc={oidc}
              purpose={purpose}
              firstRun={firstRun}
              label={label}
              onLabelChange={onLabelChange}
              tenantId={tenantId}
              onTenantIdChange={onTenantIdChange}
              clientId={clientId}
              onClientIdChange={onClientIdChange}
              subscriptionId={subscriptionId}
              onSubscriptionIdChange={onSubscriptionIdChange}
            />
          </section>
        ))}
      </div>
    </div>
  )
}
