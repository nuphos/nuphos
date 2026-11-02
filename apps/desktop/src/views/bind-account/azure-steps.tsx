import { t } from '../../i18n'
import { azureSteps } from '../../lib/cloudBindSteps'

import {
  AZURE_APP_REGISTRATIONS_URL,
  AZURE_ENTRA_OVERVIEW_URL,
  azureAppName,
  azureCredentialName,
} from './azure-console'
import { AzureBindSubscriptionStep, AzureRoleAssignmentStep } from './azure-steps-subscription'
import { StepList, ConsoleLink, CopyableValue, Fill } from './shared'

import type { AzureStepTitle } from '../../lib/cloudBindSteps'
import type { AzureOidcInfo } from '../../types'

// One Azure setup step's instructions, addressable on its own.
export function AzureWizardStepContent({
  step,
  oidc,
  purpose,
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
  label: string
  onLabelChange: (v: string) => void
  tenantId: string
  onTenantIdChange: (v: string) => void
  clientId: string
  onClientIdChange: (v: string) => void
  subscriptionId: string
  onSubscriptionIdChange: (v: string) => void
}) {
  const title: AzureStepTitle | undefined = azureSteps(purpose)[step]
  const appName = azureAppName(purpose)
  // Render the backend-provided value, or a muted placeholder until oidc-info
  // loads. Never fall back to hard-coded issuer/subject/audience — a wrong value
  // would guide the user to author a mismatched federated credential.
  const oidcValue = (v: string | undefined) =>
    v ? <CopyableValue value={v} /> : <span className="text-tertiary italic">{t('loading…')}</span>

  return (
    <>
      {title === 'Register the app & federated credential' && (
        <div className="space-y-3">
          <StepList>
            <li>
              <Fill
                text={t('In the Azure portal, open {link}')}
                link={
                  <ConsoleLink href={AZURE_APP_REGISTRATIONS_URL}>
                    Entra ID → App registrations
                  </ConsoleLink>
                }
              />
            </li>
            {/* The "this is a new one" belongs here rather than in an aside:
                this is the item where the reader who has done this before
                decides they have already done it. */}
            <li>
              <Fill
                text={t('{button} — name it {name}, single tenant, no redirect URI, then Register')}
                button={<span className="text-main">New registration</span>}
                name={<CopyableValue value={appName} />}
              />
            </li>
            <li>
              <Fill
                text={t(
                  'Open the app → left sidebar {manage} → {secrets} → {federated} → Add credential → scenario {issuer}',
                )}
                manage={<span className="text-main">Manage</span>}
                secrets={<span className="text-main">Certificates &amp; secrets</span>}
                federated={<span className="text-main">Federated credentials</span>}
                issuer={<span className="text-main">Other issuer</span>}
              />
            </li>
            <li>
              <Fill text={t('Issuer: {value}')} value={oidcValue(oidc?.issuer)} />
            </li>
            <li>
              <Fill
                text={t('Type: keep {value} (the default)')}
                value={<span className="text-main">Explicit subject identifier</span>}
              />
            </li>
            <li>
              <Fill text={t('Value: {value}')} value={oidcValue(oidc?.subject)} />
            </li>
            <li>
              <Fill
                text={t('Name (cannot be changed later): {value}')}
                value={<CopyableValue value={azureCredentialName(purpose)} />}
              />
            </li>
            <li>
              <Fill text={t('Audience: {value}')} value={oidcValue(oidc?.audience)} />
            </li>
            {/* Two pages, two moves, so two items. Both IDs are asked for in the
                final step, and neither is on the page the user is left standing
                on when the credential is added — a single line naming both
                reads as one lookup and gets half-done. */}
            <li>
              <Fill
                text={t(
                  'Back to the app → left sidebar {overview} → copy its {id} — the final step asks for it',
                )}
                overview={<span className="text-main">Overview</span>}
                id={<span className="text-main">Application (client) ID</span>}
              />
            </li>
            <li>
              <Fill
                text={t('Then open {link} → copy the {id} — the final step asks for that too')}
                link={
                  <ConsoleLink href={AZURE_ENTRA_OVERVIEW_URL}>
                    Microsoft Entra ID → Overview
                  </ConsoleLink>
                }
                id={<span className="text-main">Directory (tenant) ID</span>}
              />
            </li>
          </StepList>
          {oidc && !oidc.configured && (
            <div className="text-[11.5px] text-zOrangered-400">
              {t(
                "Nuphos's OIDC connector isn't configured on this backend yet — binding will fail until it is.",
              )}
            </div>
          )}
        </div>
      )}
      {title === 'Assign a role on the subscription' && (
        <AzureRoleAssignmentStep purpose={purpose} appName={appName} />
      )}
      {title === 'Bind the subscription' && (
        <AzureBindSubscriptionStep
          label={label}
          onLabelChange={onLabelChange}
          tenantId={tenantId}
          onTenantIdChange={onTenantIdChange}
          clientId={clientId}
          onClientIdChange={onClientIdChange}
          subscriptionId={subscriptionId}
          onSubscriptionIdChange={onSubscriptionIdChange}
        />
      )}
    </>
  )
}
