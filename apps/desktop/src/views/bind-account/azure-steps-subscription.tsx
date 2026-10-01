import { firstRunVocabulary } from '../../lib/firstRunConnect'

import {
  AZURE_APP_REGISTRATIONS_URL,
  AZURE_ENTRA_OVERVIEW_URL,
  AZURE_SUBSCRIPTIONS_URL,
} from './azure-console'
import { StepList, ConsoleLink, CopyableValue, Field } from './shared'

// The subscription half of the Azure setup: the role assignment that decides
// what the app can see, and the fields that bind it. Split from the Entra ID
// half because they are two different consoles with nothing in common but the
// app's name — and because one file holding both outgrew what a reader (or the
// max-lines rule) can take in at once.

const inputField = (value: string, onChange: (v: string) => void, placeholder: string) => (
  <input
    type="text"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
  />
)

export function AzureRoleAssignmentStep({
  firstRun,
  appName,
}: {
  purpose: 'operational'
  firstRun: boolean
  /** What step 1 had the user name the app — this step tells them to search for
   *  it, so the two must be the same string. */
  appName: string
}) {
  return (
    <div className="space-y-3">
      <StepList>
        <li>
          In the Azure portal, open{' '}
          <ConsoleLink href={AZURE_SUBSCRIPTIONS_URL}>
            Subscriptions → your subscription → Access control (IAM)
          </ConsoleLink>
        </li>
        <li>
          <span className="text-main">Add → Add role assignment</span>
        </li>
        {firstRun ? (
          // The Role tab opens on a paged grid of every built-in role, so the
          // name is given as something to paste into its search box rather than
          // something to go hunting for.
          <li>
            <span className="text-main">Role</span> tab → search{' '}
            <CopyableValue value={firstRunVocabulary('azure').scopeGrant} /> → pick it and{' '}
            <span className="text-main">nothing else</span> →{' '}
            <span className="text-main">Next</span>
          </li>
        ) : (
          <li>
            <span className="text-main">Role</span> tab (
            <span className="text-main">Job function roles</span>) → pick{' '}
            <CopyableValue value="Reader" /> to browse, or a broader role (e.g.{' '}
            <span className="font-mono text-[11px]">
              Azure Kubernetes Service Cluster User Role
            </span>{' '}
            for AKS) → <span className="text-main">Next</span>
          </li>
        )}
        {/* The Select members panel opens empty and stays empty until something
            is typed — app registrations are not in the default list. Without
            that said, the panel reads as "the app isn't here", which sends the
            user back to step 1 to register it a second time. */}
        <li>
          <span className="text-main">Members</span> tab → Assign access to{' '}
          <span className="text-main">User, group, or service principal</span> →{' '}
          <span className="text-main">+ Select members</span>. The panel shows nothing until you
          type — search <CopyableValue value={appName} /> to bring up the app you registered in step
          1, pick it → <span className="text-main">Select</span> →{' '}
          <span className="text-main">Next</span>
        </li>
        <li>
          <span className="text-main">Review + assign</span>, then back to the subscription →{' '}
          <span className="text-main">Overview</span> → copy the{' '}
          <span className="text-main">Subscription ID</span> — the final step asks for it
        </li>
      </StepList>
      <div className="text-[11.5px] text-tertiary">
        {firstRun
          ? 'Cost data is all Nuphos needs to answer its first question. When something needs more, it shows you the exact role it would need and asks — it never widens this assignment by itself.'
          : 'The role scopes exactly what Nuphos can see and do — start least-privilege and widen later.'}
      </div>
    </div>
  )
}

export function AzureBindSubscriptionStep({
  label,
  onLabelChange,
  tenantId,
  onTenantIdChange,
  clientId,
  onClientIdChange,
  subscriptionId,
  onSubscriptionIdChange,
}: {
  label: string
  onLabelChange: (v: string) => void
  tenantId: string
  onTenantIdChange: (v: string) => void
  clientId: string
  onClientIdChange: (v: string) => void
  subscriptionId: string
  onSubscriptionIdChange: (v: string) => void
}) {
  return (
    <div className="space-y-3">
      <Field label="Label" hint="A friendly name to identify this Azure subscription.">
        {inputField(label, onLabelChange, 'Acme Azure')}
      </Field>
      <Field
        label="Directory (tenant) ID"
        hint="Microsoft Entra ID → Overview → Tenant ID (one value for your whole directory)."
      >
        {inputField(tenantId, onTenantIdChange, '72f988bf-86f1-41af-91ab-2d7cd011db47')}
        <div className="mt-1.5">
          <ConsoleLink href={AZURE_ENTRA_OVERVIEW_URL}>
            Open Microsoft Entra ID → Overview
          </ConsoleLink>
        </div>
      </Field>
      <Field label="Subscription ID" hint="The subscription you assigned the role on.">
        {inputField(subscriptionId, onSubscriptionIdChange, '6f1a2b3c-9d4e-4f80-b1c2-3e4f5a6b7c8d')}
        <div className="mt-1.5">
          <ConsoleLink href={AZURE_SUBSCRIPTIONS_URL}>Open Subscriptions</ConsoleLink>
        </div>
      </Field>
      <Field
        label="Application (client) ID"
        hint="Your app registration's Overview → Application (client) ID (same value as the Enterprise app's Application ID)."
      >
        {inputField(clientId, onClientIdChange, 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d')}
        <div className="mt-1.5">
          <ConsoleLink href={AZURE_APP_REGISTRATIONS_URL}>Open App registrations</ConsoleLink>
        </div>
      </Field>
    </div>
  )
}
