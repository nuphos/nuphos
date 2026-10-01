import { azureSteps } from '../../lib/cloudBindSteps'

import {
  AZURE_APP_REGISTRATIONS_URL,
  AZURE_ENTRA_OVERVIEW_URL,
  azureAppName,
  azureCredentialName,
} from './azure-console'
import { AzureBindSubscriptionStep, AzureRoleAssignmentStep } from './azure-steps-subscription'
import { StepList, ConsoleLink, CopyableValue } from './shared'

import type { AzureStepTitle } from '../../lib/cloudBindSteps'
import type { AzureOidcInfo } from '../../types'

// One Azure setup step's instructions, addressable on its own. Split out of the
// wizard so the first-run panel can stack every step in one scrollable column —
// a docked panel has the height for a checklist, and someone working down a list
// while tabbing to their browser should not have to click Next to see what's
// coming. Both surfaces render this, so the issuer, audience and subject the
// user pins into a federated credential exist in exactly one place.
export function AzureWizardStepContent({
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
  const title: AzureStepTitle | undefined = azureSteps(purpose)[step]
  const appName = azureAppName(purpose)
  // Render the backend-provided value, or a muted placeholder until oidc-info
  // loads. Never fall back to hard-coded issuer/subject/audience — a wrong value
  // would guide the user to author a mismatched federated credential.
  const oidcValue = (v: string | undefined) =>
    v ? <CopyableValue value={v} /> : <span className="text-tertiary italic">loading…</span>

  return (
    <>
      {title === 'Register the app & federated credential' && (
        <div className="space-y-3">
          <StepList>
            <li>
              In the Azure portal, open{' '}
              <ConsoleLink href={AZURE_APP_REGISTRATIONS_URL}>
                Entra ID → App registrations
              </ConsoleLink>
            </li>
            {/* The "this is a new one" belongs here rather than in an aside:
                this is the item where the reader who has done this before
                decides they have already done it. */}
            <li>
              <span className="text-main">New registration</span> — name it{' '}
              <CopyableValue value={appName} />, single tenant, no redirect URI, then Register
            </li>
            <li>
              Open the app → left sidebar <span className="text-main">Manage</span> →{' '}
              <span className="text-main">Certificates &amp; secrets</span> →{' '}
              <span className="text-main">Federated credentials</span> → Add credential → scenario{' '}
              <span className="text-main">Other issuer</span>
            </li>
            <li>Issuer: {oidcValue(oidc?.issuer)}</li>
            <li>
              Type: keep <span className="text-main">Explicit subject identifier</span> (the
              default)
            </li>
            <li>Value: {oidcValue(oidc?.subject)}</li>
            <li>
              Name (cannot be changed later): <CopyableValue value={azureCredentialName(purpose)} />
            </li>
            <li>Audience: {oidcValue(oidc?.audience)}</li>
            {/* Two pages, two moves, so two items. Both IDs are asked for in the
                final step, and neither is on the page the user is left standing
                on when the credential is added — a single line naming both
                reads as one lookup and gets half-done. */}
            <li>
              Back to the app → left sidebar <span className="text-main">Overview</span> → copy its{' '}
              <span className="text-main">Application (client) ID</span> — the final step asks for
              it
            </li>
            <li>
              Then open{' '}
              <ConsoleLink href={AZURE_ENTRA_OVERVIEW_URL}>
                Microsoft Entra ID → Overview
              </ConsoleLink>{' '}
              → copy the <span className="text-main">Directory (tenant) ID</span> — the final step
              asks for that too
            </li>
          </StepList>
          {oidc && !oidc.configured && (
            <div className="text-[11.5px] text-zOrangered-400">
              Nuphos&apos;s OIDC connector isn&apos;t configured on this backend yet — binding will
              fail until it is.
            </div>
          )}
        </div>
      )}
      {title === 'Assign a role on the subscription' && (
        <AzureRoleAssignmentStep purpose={purpose} firstRun={firstRun} appName={appName} />
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
