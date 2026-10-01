import { gcpContentStep, gcpSpec } from '../../lib/cloudBindSteps'

import { GcpFirstRunStep } from './gcp-steps-first-run'
import { GcpTokenCreatorNote, GcpTokenCreatorPrincipal } from './gcp-token-creator'
import { ConsoleLink, CopyableValue, Field, StepList, StepNote } from './shared'

import type { GcpWifInfo } from '../../types'

// The Cloud Console "Create service account" flow is itself a 3-sub-step
// wizard, so we mirror those sub-steps 1:1 and the guide matches exactly what
// is on screen. The first-run scope takes a route of its own — see gcpSteps().
//
// Same shape as the AWS route and the first-run one: a numbered list of moves
// with the console link as its first item, and any aside below it.

// One-click Cloud Console deep links (open the exact page for each step). No
// project param — the console opens on the user's last project with a switcher.
const GCP_CONSOLE = {
  enableResourceManager:
    'https://console.cloud.google.com/apis/library/cloudresourcemanager.googleapis.com',
  enableIam: 'https://console.cloud.google.com/apis/library/iam.googleapis.com',
  createServiceAccount: 'https://console.cloud.google.com/iam-admin/serviceaccounts/create',
  serviceAccounts: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
  iam: 'https://console.cloud.google.com/iam-admin/iam',
} as const

export function GcpWizardStepContent({
  step: purposeStep,
  purpose,
  firstRun,
  wif,
  saEmail,
  onSaEmailChange,
  projectId,
  onProjectIdChange,
}: {
  /** Index into the list this purpose actually shows — mapped back onto the
   *  full list below, since the admin list drops 'Enable APIs'. */
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
  const spec = gcpSpec(purpose, firstRun)
  const step = gcpContentStep(purpose, purposeStep)

  const enterDetails = (
    <div className="space-y-1">
      <div className="text-[12.5px] text-secondary leading-relaxed mb-2">
        Enter the service account you created and its project ID.
      </div>
      <Field label="Service Account Email" hint="Nuphos will impersonate this service account.">
        <input
          type="text"
          value={saEmail}
          onChange={(e) => onSaEmailChange(e.target.value)}
          placeholder={spec.saEmail.replace('PROJECT_ID', 'my-project')}
          className="w-full h-9 px-2.5 rounded-md bg-zGray-850 border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field label="Project ID">
        <input
          type="text"
          value={projectId}
          onChange={(e) => onProjectIdChange(e.target.value)}
          placeholder="my-project"
          className="w-full h-9 px-2.5 rounded-md bg-zGray-850 border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
    </div>
  )

  // ── First-run scope: 5 steps, because the billing grant cannot ride inside
  //    the create-SA wizard and gets one of its own ──
  if (spec.grantOn === 'billing-account') {
    return <GcpFirstRunStep step={step} spec={spec} wif={wif} details={enterDetails} />
  }

  // ── Project scope: 6 steps, mirroring the on-screen create-SA wizard ──
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
        </StepList>
        <StepNote>
          That opens the console&apos;s own 3-step wizard — the next two steps here match its
          sub-steps. The account&apos;s email will look like{' '}
          <span className="font-mono">{spec.saEmail}</span> — you&apos;ll paste it in the last step.
        </StepNote>
      </div>
    )
  }
  if (step === 2) {
    return (
      <div className="space-y-3">
        <StepList>
          <li>
            On the <span className="text-main">Grant this service account access to project</span>{' '}
            sub-step, add the role <CopyableValue value={spec.role} /> ({spec.roleLabel})
          </li>
          <li>
            Click <span className="text-main">Continue</span>
          </li>
        </StepList>
        {spec.isBroad && (
          <StepNote>
            Prefer least-privilege? <span className="text-main">{spec.roleLabel}</span> is broad —
            you can instead add only the roles the agent needs (e.g. Kubernetes Engine Admin,
            Compute Viewer). Add each one here.
          </StepNote>
        )}
        {spec.scopeNote && <StepNote>{spec.scopeNote}</StepNote>}
        {firstRun && (
          <StepNote>
            Add <span className="text-main">nothing else</span> here. Cost data is all Nuphos needs
            to answer its first question, and anything more is a decision you can make later, with a
            reason.
          </StepNote>
        )}
      </div>
    )
  }
  if (step === 3) {
    return (
      <div className="space-y-3">
        <StepList>
          <li>
            On the <span className="text-main">Principals with access</span> sub-step, leave both
            fields empty
          </li>
          <li>
            Click <span className="text-main">Done</span>
          </li>
        </StepList>
        <StepNote>
          The token-creator grant this account needs isn&apos;t offered here — it goes on the
          account itself, in the next step.
        </StepNote>
      </div>
    )
  }
  if (step === 4) {
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
        <GcpTokenCreatorNote wif={wif} saName={spec.sa} />
      </div>
    )
  }

  return enterDetails
}
