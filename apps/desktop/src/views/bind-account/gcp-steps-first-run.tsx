import { GcpTokenCreatorNote, GcpTokenCreatorPrincipal } from './gcp-token-creator'
import { ConsoleLink, CopyableValue, StepList, StepNote } from './shared'

import type { gcpSpec } from '../../lib/cloudBindSteps'
import type { GcpWifInfo } from '../../types'

// The first-run scope, which asks for `roles/billing.viewer`. That role's
// lowest grantable resource is the billing account, so unlike the project-scoped
// bind it cannot ride along inside Google's create-service-account wizard: both
// of that wizard's optional sub-steps are left empty, and the grant gets a step
// of its own on the billing account's Account Management page. Five steps rather
// than six — the two skipped sub-steps collapse into the create step, where
// "leave it empty" is one instruction instead of two screens.
//
// Laid out like the AWS route: a numbered list of moves with the console link
// as the first item, and the screenshots left to the checklist's own block
// above. One shape for all three clouds — a step that invents its own is a step
// the reader has to learn to read before they can follow it.

const GCP_CONSOLE = {
  enableResourceManager:
    'https://console.cloud.google.com/apis/library/cloudresourcemanager.googleapis.com',
  enableIam: 'https://console.cloud.google.com/apis/library/iam.googleapis.com',
  createServiceAccount: 'https://console.cloud.google.com/iam-admin/serviceaccounts/create',
  serviceAccounts: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
  // The account list, not a specific account: which billing account pays for
  // this project is the user's to pick, and we have no ID to deep-link with.
  billing: 'https://console.cloud.google.com/billing',
} as const

export function GcpFirstRunStep({
  step,
  spec,
  wif,
  details,
}: {
  step: number
  spec: ReturnType<typeof gcpSpec>
  /** Nuphos's principal for the Token Creator grant; null until it loads. */
  wif: GcpWifInfo | null
  /** The final step's own form — it belongs to the wizard, not to the console. */
  details: React.ReactNode
}) {
  if (step === 0) {
    return (
      <StepList>
        <li>
          Open{' '}
          <ConsoleLink href={GCP_CONSOLE.enableResourceManager}>
            Cloud Resource Manager API
          </ConsoleLink>{' '}
          and click <span className="text-main">Enable</span>
        </li>
        <li>
          Open <ConsoleLink href={GCP_CONSOLE.enableIam}>IAM API</ConsoleLink> and click{' '}
          <span className="text-main">Enable</span>
        </li>
      </StepList>
    )
  }
  if (step === 1) {
    return (
      <div className="space-y-3">
        <StepList>
          <li>
            Open{' '}
            <ConsoleLink href={GCP_CONSOLE.createServiceAccount}>
              IAM &amp; Admin → Create service account
            </ConsoleLink>
          </li>
          <li>
            Service account name: <CopyableValue value={spec.sa} />
          </li>
          <li>
            Click <span className="text-main">Create and continue</span>
          </li>
          <li>
            Leave <span className="text-main">Permissions</span> and{' '}
            <span className="text-main">Principals with access</span> empty, then click{' '}
            <span className="text-main">Done</span>
          </li>
        </StepList>
        <StepNote>
          Neither grant this account needs can be made in that wizard: the billing role isn&apos;t
          offered at project level, and the token-creator grant goes on the account itself, two
          steps from now. Its email will look like <span className="font-mono">{spec.saEmail}</span>{' '}
          — you&apos;ll need it next.
        </StepNote>
      </div>
    )
  }
  if (step === 2) {
    return (
      <div className="space-y-3">
        <StepList>
          <li>
            Open <ConsoleLink href={GCP_CONSOLE.billing}>Billing</ConsoleLink> and pick the billing
            account that pays for this project
          </li>
          <li>
            Open <span className="text-main">Account management</span>, then click{' '}
            <span className="text-main">Add principal</span>
          </li>
          {/* The full email, not "the account you just created": this page is
              nowhere near the wizard that made it, so there is no context to
              lean on — whatever goes in this field has to be typed out here. */}
          <li>
            New principals: <span className="font-mono">{spec.saEmail}</span>, with your own project
            ID in place of <CopyableValue value="PROJECT_ID" />
          </li>
          <li>
            Role: <CopyableValue value={spec.role} /> ({spec.roleLabel})
          </li>
          <li>
            Click <span className="text-main">Save</span>
          </li>
        </StepList>
        <StepNote>
          {spec.scopeNote} Add <span className="text-main">nothing else</span> here — cost data is
          all Nuphos needs to answer its first question, and anything more is a decision you can
          make later, with a reason.
        </StepNote>
      </div>
    )
  }
  if (step === 3) {
    return (
      <div className="space-y-3">
        <StepList>
          <li>
            Open{' '}
            <ConsoleLink href={GCP_CONSOLE.serviceAccounts}>
              IAM &amp; Admin → Service Accounts
            </ConsoleLink>{' '}
            and click <span className="text-main">{spec.sa}</span>
          </li>
          <li>
            Open its <span className="text-main">Principals with access</span> tab, then click{' '}
            <span className="text-main">Grant access</span>
          </li>
          <li>
            New principals: <GcpTokenCreatorPrincipal wif={wif} />
          </li>
          <li>
            Role: <CopyableValue value="Service Account Token Creator" />
          </li>
          <li>
            Click <span className="text-main">Save</span>
          </li>
        </StepList>
        <StepNote>
          You filled a field called <span className="text-main">New principals</span> two steps ago
          with your <em>own</em> account. Both panels ask the same question — who may reach this
          resource — and the <span className="text-main">Resource</span> line at the top is what
          changes: that one was your billing account, this one is {spec.sa} itself.
        </StepNote>
        <GcpTokenCreatorNote wif={wif} saName={spec.sa} />
      </div>
    )
  }

  // Fragment-wrapped so every branch returns an element, not a bare node.
  return <>{details}</>
}
