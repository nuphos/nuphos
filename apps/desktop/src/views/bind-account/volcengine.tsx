import clsx from 'clsx'

import { StepList, ConsoleLink, CopyableValue, Field } from './shared'
import { VOLC_STEPS } from './steps'

import type { VolcengineOidcInfo } from '../../types'

const VOLC_CREATE_PROVIDER_URL = 'https://console.volcengine.com/iam/identitymanage/idp'
const VOLC_CREATE_ROLE_URL = 'https://console.volcengine.com/iam/identitymanage/role'
// Region-scoped path; the console redirects to the account's region picker.
const VOLC_ROLE_AUTH_URL = 'https://console.volcengine.com/vke'

export function VolcengineBindWizard({
  step,
  oidc,
  label,
  onLabelChange,
  roleTrn,
  onRoleTrnChange,
}: {
  step: number
  oidc: VolcengineOidcInfo | null
  label: string
  onLabelChange: (v: string) => void
  roleTrn: string
  onRoleTrnChange: (v: string) => void
}) {
  // Render the backend-provided value, or a muted placeholder until oidc-info
  // loads. Never fall back to hard-coded issuer/audience/subject — a wrong value
  // would guide the user to author a mismatched trust policy (fetch failure is
  // surfaced via toast where the fetch runs).
  const oidcValue = (v: string | undefined) =>
    v ? <CopyableValue value={v} /> : <span className="text-tertiary italic">loading…</span>

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-1 mb-2">
          {VOLC_STEPS.map((title, i) => (
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
          Step {step + 1} of {VOLC_STEPS.length}
        </div>
        <div className="text-[13.5px] text-main font-medium">{VOLC_STEPS[step]}</div>
      </div>

      <div className="t-page-slide t-wizard-slide" data-page={step + 1}>
        {VOLC_STEPS.map((title, i) => (
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
            {i === 0 && (
              <div className="space-y-3">
                <StepList>
                  <li>
                    In the Volcengine console, open{' '}
                    <ConsoleLink href={VOLC_CREATE_PROVIDER_URL}>
                      IAM → Identity Providers
                    </ConsoleLink>
                  </li>
                  <li>
                    Add an <span className="text-main">OIDC</span> provider, SSO type{' '}
                    <span className="text-main">Role SSO</span>
                  </li>
                  <li>Issuer URL: {oidcValue(oidc?.issuer)}</li>
                  <li>
                    Fingerprint: click <span className="text-main">Get it now</span>
                  </li>
                  <li>Client ID: {oidcValue(oidc?.audience)}</li>
                  <li>
                    Leave <span className="text-main">Min Issue Time</span> default, then Submit
                  </li>
                </StepList>
                {oidc && !oidc.configured && (
                  <div className="text-[11.5px] text-zOrangered-400">
                    Nuphos&apos;s OIDC connector isn&apos;t configured on this backend yet — binding
                    will fail until it is.
                  </div>
                )}
              </div>
            )}
            {i === 1 && (
              <div className="space-y-3">
                <StepList>
                  <li>
                    In the Volcengine console, open{' '}
                    <ConsoleLink href={VOLC_CREATE_ROLE_URL}>IAM → Roles</ConsoleLink>
                  </li>
                  <li>
                    Create Role → trust identity{' '}
                    <span className="text-main">Identity provider</span> →{' '}
                    <span className="text-main">OIDC</span> → pick the provider you just added
                  </li>
                  <li>
                    Attach a policy covering VKE + ECS —{' '}
                    <span className="font-mono text-[11px]">VKEFullAccess</span>, or{' '}
                    <span className="font-mono text-[11px]">AdministratorAccess</span> for a
                    dedicated account
                  </li>
                  <li>
                    Create it, then open the role and copy its{' '}
                    <span className="text-main">TRN</span>
                  </li>
                </StepList>
                <div className="text-[11.5px] text-tertiary">
                  IAM only covers the control plane — the next step grants this role access inside
                  your VKE clusters.
                </div>
              </div>
            )}
            {i === 2 && (
              <div className="space-y-3">
                <div className="text-[11.5px] text-tertiary">
                  Only needed for VKE (Kubernetes) clusters — no clusters, or ECS only? Hit Next and
                  skip this step.
                </div>
                <StepList>
                  <li>
                    In the VKE console, open{' '}
                    <ConsoleLink href={VOLC_ROLE_AUTH_URL}>
                      Authorizations → Role authorization
                    </ConsoleLink>
                  </li>
                  <li>
                    Sign in as the{' '}
                    <span className="text-main">cluster creator or root account</span> — only they
                    can grant in-cluster RBAC
                  </li>
                  <li>
                    Enter the exact <span className="text-main">role name</span> you created in step
                    2, then continue
                  </li>
                  <li>
                    <span className="text-main">Add role authorization</span> — pick your clusters
                    (or Account All Resources), a namespace scope, and an access right (read-only is
                    enough for browsing)
                  </li>
                  <li>Repeat for each region that has clusters</li>
                </StepList>
                <div className="text-[11.5px] text-tertiary">
                  Skipping this? Clusters still bind, but their contents stay forbidden — Nuphos
                  will show this same guidance when you open one.
                </div>
              </div>
            )}
            {i === 3 && (
              <div className="space-y-3">
                <Field label="Label" hint="A friendly name to identify this Volcengine account.">
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => onLabelChange(e.target.value)}
                    placeholder="Acme Volcengine"
                    className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
                  />
                </Field>
                <Field label="Role TRN" hint="The TRN of the role you created in step 2.">
                  <input
                    type="text"
                    value={roleTrn}
                    onChange={(e) => onRoleTrnChange(e.target.value)}
                    placeholder="trn:iam::2100000000:role/Zeabur"
                    className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
                  />
                </Field>
                <div className="text-[11.5px] text-tertiary">
                  Optional: pin the role&apos;s trust policy to subject {oidcValue(oidc?.subject)}{' '}
                  so only this team can assume it.
                </div>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
