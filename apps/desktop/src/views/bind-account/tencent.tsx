import clsx from 'clsx'

import { AppSelect } from '../../components/ui/select'

import { StepList, ConsoleLink, CopyableValue, Field } from './shared'
import { TENCENT_STEPS } from './steps'

import type { TencentOidcInfo, TencentSite } from '../../types'

// The CAM console lives on a different host per partition: China on
// cloud.tencent.com, International on tencentcloud.com.
const TENCENT_CAM_HOST: Record<TencentSite, string> = {
  china: 'https://console.cloud.tencent.com/cam',
  international: 'https://console.tencentcloud.com/cam',
}

export function TencentBindWizard({
  step,
  oidc,
  site,
  onSiteChange,
  label,
  onLabelChange,
  roleArn,
  onRoleArnChange,
  providerId,
  onProviderIdChange,
}: {
  step: number
  oidc: TencentOidcInfo | null
  site: TencentSite
  onSiteChange: (v: TencentSite) => void
  label: string
  onLabelChange: (v: string) => void
  roleArn: string
  onRoleArnChange: (v: string) => void
  providerId: string
  onProviderIdChange: (v: string) => void
}) {
  // Render the backend-provided value, or a muted placeholder until oidc-info
  // loads. Never fall back to hard-coded issuer/audience/subject.
  const oidcValue = (v: string | undefined) =>
    v ? <CopyableValue value={v} /> : <span className="text-tertiary italic">loading…</span>

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-1 mb-2">
          {TENCENT_STEPS.map((title, i) => (
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
          Step {step + 1} of {TENCENT_STEPS.length}
        </div>
        <div className="text-[13.5px] text-main font-medium">{TENCENT_STEPS[step]}</div>
      </div>

      <div className="t-page-slide t-wizard-slide" data-page={step + 1}>
        {TENCENT_STEPS.map((title, i) => (
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
                <Field
                  label="Site"
                  hint="Tencent Cloud has two isolated partitions — pick the one the CAM account belongs to."
                >
                  <AppSelect
                    ariaLabel="Tencent Cloud site"
                    value={site}
                    onValueChange={(value) => onSiteChange(value as TencentSite)}
                    options={[
                      { value: 'china', label: 'Tencent Cloud · China (cloud.tencent.com)' },
                      {
                        value: 'international',
                        label: 'Tencent Cloud · International (tencentcloud.com)',
                      },
                    ]}
                    triggerClassName="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 text-[12.5px] text-main"
                  />
                </Field>
                <StepList>
                  <li>
                    In the CAM console, open{' '}
                    <ConsoleLink href={`${TENCENT_CAM_HOST[site]}/idp`}>
                      Identity Providers → Role SSO
                    </ConsoleLink>
                  </li>
                  <li>
                    Create an <span className="text-main">OIDC</span> identity provider
                  </li>
                  <li>Issuer URL: {oidcValue(oidc?.issuer)}</li>
                  <li>Client ID: {oidcValue(oidc?.audience)}</li>
                  <li>Public key (Tencent doesn&apos;t auto-fetch it): {oidcValue(oidc?.jwks)}</li>
                  <li>
                    Note the provider <span className="text-main">name</span> — you enter it below
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
                    In the CAM console, open{' '}
                    <ConsoleLink href={`${TENCENT_CAM_HOST[site]}/role`}>Roles</ConsoleLink>
                  </li>
                  <li>
                    Create Role → <span className="text-main">identity provider</span> →{' '}
                    <span className="text-main">OIDC</span> → pick the provider you just added
                  </li>
                  <li>
                    Condition <span className="font-mono text-[11px]">oidc:aud</span> ={' '}
                    {oidcValue(oidc?.audience)} (
                    <span className="font-mono text-[11px]">oidc:iss</span> is auto-filled)
                  </li>
                  <li>
                    Optional: add <span className="font-mono text-[11px]">oidc:sub</span> ={' '}
                    {oidcValue(oidc?.subject)} to lock it to this team
                  </li>
                  <li>
                    Attach a policy covering TKE + CVM —{' '}
                    <span className="font-mono text-[11px]">QcloudTKEFullAccess</span> +{' '}
                    <span className="font-mono text-[11px]">QcloudCVMReadOnlyAccess</span>, or{' '}
                    <span className="font-mono text-[11px]">AdministratorAccess</span>
                  </li>
                  <li>
                    Create it, then open the role and copy its{' '}
                    <span className="text-main">ARN</span>
                  </li>
                </StepList>
                <div className="text-[11.5px] text-tertiary">
                  IAM only covers the control plane — the next step grants this role access inside
                  your TKE clusters.
                </div>
              </div>
            )}
            {i === 2 && (
              <div className="space-y-3">
                <div className="text-[11.5px] text-tertiary">
                  Only needed for TKE (Kubernetes) clusters — no clusters, or CVM only? Hit Next and
                  skip this step. The authorization page lives inside each cluster, so there is no
                  direct link.
                </div>
                <StepList>
                  <li>
                    In the TKE console open each cluster →{' '}
                    <span className="text-main">Authorization Management</span> →{' '}
                    <span className="text-main">ClusterRoleBinding</span>
                  </li>
                  <li>
                    <span className="text-main">RBAC policy generator</span> → account type{' '}
                    <span className="text-main">Service role</span> → select the role you created in
                    step 2
                  </li>
                  <li>
                    Next — pick the RBAC permissions (read-only is enough for browsing) and apply
                  </li>
                  <li>Repeat per cluster</li>
                </StepList>
                <div className="text-[11.5px] text-tertiary">
                  Skipping this? Clusters still bind, but their contents stay forbidden — Nuphos
                  will show this same guidance when you open one.
                </div>
              </div>
            )}
            {i === 3 && (
              <div className="space-y-3">
                <Field label="Label" hint="A friendly name to identify this Tencent account.">
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => onLabelChange(e.target.value)}
                    placeholder="Acme Tencent"
                    className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
                  />
                </Field>
                <Field label="Role ARN" hint="The ARN of the CAM role you created in step 2.">
                  <input
                    type="text"
                    value={roleArn}
                    onChange={(e) => onRoleArnChange(e.target.value)}
                    placeholder="qcs::cam::uin/123456789:roleName/Nuphos"
                    className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
                  />
                </Field>
                <Field
                  label="OIDC Provider Name"
                  hint="The name of the CAM OIDC provider from step 1."
                >
                  <input
                    type="text"
                    value={providerId}
                    onChange={(e) => onProviderIdChange(e.target.value)}
                    placeholder="nuphos"
                    className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
                  />
                </Field>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
