import { t } from '../../i18n'

import {
  AZURE_APP_REGISTRATIONS_URL,
  AZURE_ENTRA_OVERVIEW_URL,
  AZURE_SUBSCRIPTIONS_URL,
} from './azure-console'
import { StepList, ConsoleLink, CopyableValue, Field, Fill } from './shared'

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
    className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
  />
)

export function AzureRoleAssignmentStep({
  appName,
}: {
  purpose: 'operational'
  /** What step 1 had the user name the app — this step tells them to search for
   *  it, so the two must be the same string. */
  appName: string
}) {
  return (
    <div className="space-y-3">
      <StepList>
        <li>
          <Fill
            text={t('In the Azure portal, open {link}')}
            link={
              <ConsoleLink href={AZURE_SUBSCRIPTIONS_URL}>
                {t('Subscriptions → your subscription → Access control (IAM)')}
              </ConsoleLink>
            }
          />
        </li>
        <li>
          <span className="text-main">Add → Add role assignment</span>
        </li>
        <li>
          <Fill
            text={t(
              '{role} tab ({jobRoles}) → pick {reader} to browse, or a broader role (e.g. {aksRole} for AKS) → {next}',
            )}
            role={<span className="text-main">Role</span>}
            jobRoles={<span className="text-main">Job function roles</span>}
            reader={<CopyableValue value="Reader" />}
            aksRole={
              <span className="font-mono text-[11px]">
                Azure Kubernetes Service Cluster User Role
              </span>
            }
            next={<span className="text-main">Next</span>}
          />
        </li>
        {/* The Select members panel opens empty and stays empty until something
            is typed — app registrations are not in the default list. Without
            that said, the panel reads as "the app isn't here", which sends the
            user back to step 1 to register it a second time. */}
        <li>
          <Fill
            text={t(
              '{members} tab → Assign access to {principal} → {selectMembers}. The panel shows nothing until you type — search {app} to bring up the app you registered in step 1, pick it → {select} → {next}',
            )}
            members={<span className="text-main">Members</span>}
            principal={<span className="text-main">User, group, or service principal</span>}
            selectMembers={<span className="text-main">+ Select members</span>}
            app={<CopyableValue value={appName} />}
            select={<span className="text-main">Select</span>}
            next={<span className="text-main">Next</span>}
          />
        </li>
        <li>
          <Fill
            text={t(
              '{review}, then back to the subscription → {overview} → copy the {id} — the final step asks for it',
            )}
            review={<span className="text-main">Review + assign</span>}
            overview={<span className="text-main">Overview</span>}
            id={<span className="text-main">Subscription ID</span>}
          />
        </li>
      </StepList>
      <div className="text-[11.5px] text-tertiary">
        {t(
          'The role scopes exactly what Nuphos can see and do — start least-privilege and widen later.',
        )}
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
      <Field label={t('Label')} hint={t('A friendly name to identify this Azure subscription.')}>
        {inputField(label, onLabelChange, 'Acme Azure')}
      </Field>
      <Field
        label={t('Directory (tenant) ID')}
        hint={t('Microsoft Entra ID → Overview → Tenant ID (one value for your whole directory).')}
      >
        {inputField(tenantId, onTenantIdChange, '72f988bf-86f1-41af-91ab-2d7cd011db47')}
        <div className="mt-1.5">
          <ConsoleLink href={AZURE_ENTRA_OVERVIEW_URL}>
            {t('Open {page}', { page: 'Microsoft Entra ID → Overview' })}
          </ConsoleLink>
        </div>
      </Field>
      <Field label={t('Subscription ID')} hint={t('The subscription you assigned the role on.')}>
        {inputField(subscriptionId, onSubscriptionIdChange, '6f1a2b3c-9d4e-4f80-b1c2-3e4f5a6b7c8d')}
        <div className="mt-1.5">
          <ConsoleLink href={AZURE_SUBSCRIPTIONS_URL}>
            {t('Open {page}', { page: 'Subscriptions' })}
          </ConsoleLink>
        </div>
      </Field>
      <Field
        label={t('Application (client) ID')}
        hint={t(
          "Your app registration's Overview → Application (client) ID (same value as the Enterprise app's Application ID).",
        )}
      >
        {inputField(clientId, onClientIdChange, 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d')}
        <div className="mt-1.5">
          <ConsoleLink href={AZURE_APP_REGISTRATIONS_URL}>
            {t('Open {page}', { page: 'App registrations' })}
          </ConsoleLink>
        </div>
      </Field>
    </div>
  )
}
