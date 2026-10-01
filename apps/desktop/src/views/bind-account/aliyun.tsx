import clsx from 'clsx'

import { AppSelect } from '../../components/ui/select'

import { StepList, ConsoleLink, CopyableValue, Field, StepNote } from './shared'
import { ALIYUN_STEPS } from './steps'

import type { AliyunOidcInfo, AliyunSite } from '../../types'

// The RAM console lives on a different host per partition: China on aliyun.com,
// International on alibabacloud.com.
const ALIYUN_RAM_HOST: Record<AliyunSite, string> = {
  china: 'https://ram.console.aliyun.com',
  international: 'https://ram.console.alibabacloud.com',
}

export function AliyunBindWizard({
  step,
  oidc,
  site,
  onSiteChange,
  label,
  onLabelChange,
  roleArn,
  onRoleArnChange,
  oidcProviderArn,
  onOidcProviderArnChange,
}: {
  step: number
  oidc: AliyunOidcInfo | null
  site: AliyunSite
  onSiteChange: (v: AliyunSite) => void
  label: string
  onLabelChange: (v: string) => void
  roleArn: string
  onRoleArnChange: (v: string) => void
  oidcProviderArn: string
  onOidcProviderArnChange: (v: string) => void
}) {
  // Render the backend-provided value, or a muted placeholder until oidc-info
  // loads. Never fall back to hard-coded issuer/audience/subject.
  const oidcValue = (v: string | undefined) =>
    v ? <CopyableValue value={v} /> : <span className="text-tertiary italic">loading…</span>

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-1 mb-2">
          {ALIYUN_STEPS.map((title, i) => (
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
          Step {step + 1} of {ALIYUN_STEPS.length}
        </div>
        <div className="text-[13.5px] text-main font-medium">{ALIYUN_STEPS[step]}</div>
      </div>

      <div className="t-page-slide t-wizard-slide" data-page={step + 1}>
        {ALIYUN_STEPS.map((title, i) => (
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
                  hint="Alibaba Cloud has two isolated partitions — pick the one the RAM account belongs to."
                >
                  <AppSelect
                    ariaLabel="Alibaba Cloud site"
                    value={site}
                    onValueChange={(value) => onSiteChange(value as AliyunSite)}
                    options={[
                      { value: 'china', label: 'Aliyun · China (aliyun.com)' },
                      {
                        value: 'international',
                        label: 'Alibaba Cloud · International (alibabacloud.com)',
                      },
                    ]}
                    triggerClassName="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 text-[12.5px] text-main"
                  />
                </Field>
                <StepList>
                  <li>
                    In the RAM console, open{' '}
                    <ConsoleLink href={`${ALIYUN_RAM_HOST[site]}/providers`}>
                      Identity Providers
                    </ConsoleLink>
                  </li>
                  <li>
                    Create an <span className="text-main">OIDC</span> identity provider
                  </li>
                  <li>Issuer URL: {oidcValue(oidc?.issuer)}</li>
                  <li>Client ID: {oidcValue(oidc?.audience)}</li>
                  <li>
                    Create it, then copy the provider&apos;s <span className="text-main">ARN</span>
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
                    In the RAM console, open{' '}
                    <ConsoleLink href={`${ALIYUN_RAM_HOST[site]}/roles`}>Roles</ConsoleLink>
                  </li>
                  <li>
                    Create Role → trusted entity <span className="text-main">IdP</span> →{' '}
                    <span className="text-main">OIDC</span> → pick the provider you just added
                  </li>
                  <li>
                    Add a condition on <span className="font-mono text-[11px]">oidc:sub</span> ={' '}
                    {oidcValue(oidc?.subject)} so only this team can assume it
                  </li>
                  <li>
                    Attach a policy covering ACK + ECS —{' '}
                    <span className="font-mono text-[11px]">AliyunCSFullAccess</span> +{' '}
                    <span className="font-mono text-[11px]">AliyunECSReadOnlyAccess</span>, or{' '}
                    <span className="font-mono text-[11px]">AdministratorAccess</span>
                  </li>
                  <li>
                    Create it, then open the role and copy its{' '}
                    <span className="text-main">ARN</span>
                  </li>
                </StepList>
                <StepNote>
                  Keep the trust policy the console generates — its action is{' '}
                  <span className="font-mono">sts:AssumeRole</span>, which is what RAM grants to an
                  OIDC provider. <span className="font-mono">AssumeRoleWithOIDC</span> is the STS
                  API Nuphos calls, not a trust-policy action; changing the action to it makes the
                  bind fail.
                </StepNote>
              </div>
            )}
            {i === 2 && (
              <div className="space-y-3">
                <Field label="Label" hint="A friendly name to identify this Alibaba Cloud account.">
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => onLabelChange(e.target.value)}
                    placeholder="Acme Alibaba Cloud"
                    className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
                  />
                </Field>
                <Field label="Role ARN" hint="The ARN of the RAM role you created in step 2.">
                  <input
                    type="text"
                    value={roleArn}
                    onChange={(e) => onRoleArnChange(e.target.value)}
                    placeholder="acs:ram::123456789012345:role/NuphosConnector"
                    className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
                  />
                </Field>
                <Field
                  label="OIDC Provider ARN"
                  hint="The ARN of the RAM OIDC provider from step 1."
                >
                  <input
                    type="text"
                    value={oidcProviderArn}
                    onChange={(e) => onOidcProviderArnChange(e.target.value)}
                    placeholder="acs:ram::123456789012345:oidc-provider/nuphos"
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
