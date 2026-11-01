import clsx from 'clsx'

import { AppSelect } from '../../components/ui/select'
import { t } from '../../i18n'

import { StepList, ConsoleLink, CopyableValue, Field, Fill, StepNote } from './shared'
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
    v ? <CopyableValue value={v} /> : <span className="text-tertiary italic">{t('loading…')}</span>

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
          {t('Step {n} of {total}', { n: step + 1, total: ALIYUN_STEPS.length })}
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
                  label={t('Site')}
                  hint={t(
                    'Alibaba Cloud has two isolated partitions — pick the one the RAM account belongs to.',
                  )}
                >
                  <AppSelect
                    ariaLabel={t('Alibaba Cloud site')}
                    value={site}
                    onValueChange={(value) => onSiteChange(value as AliyunSite)}
                    options={[
                      { value: 'china', label: t('Aliyun · China (aliyun.com)') },
                      {
                        value: 'international',
                        label: t('Alibaba Cloud · International (alibabacloud.com)'),
                      },
                    ]}
                  />
                </Field>
                <StepList>
                  <li>
                    <Fill
                      text={t('In the RAM console, open {link}')}
                      link={
                        <ConsoleLink href={`${ALIYUN_RAM_HOST[site]}/providers`}>
                          Identity Providers
                        </ConsoleLink>
                      }
                    />
                  </li>
                  <li>
                    <Fill
                      text={t('Create an {type} identity provider')}
                      type={<span className="text-main">OIDC</span>}
                    />
                  </li>
                  <li>
                    <Fill text={t('Issuer URL: {value}')} value={oidcValue(oidc?.issuer)} />
                  </li>
                  <li>
                    <Fill text={t('Client ID: {value}')} value={oidcValue(oidc?.audience)} />
                  </li>
                  <li>
                    <Fill
                      text={t("Create it, then copy the provider's {arn}")}
                      arn={<span className="text-main">ARN</span>}
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
            {i === 1 && (
              <div className="space-y-3">
                <StepList>
                  <li>
                    <Fill
                      text={t('In the RAM console, open {link}')}
                      link={
                        <ConsoleLink href={`${ALIYUN_RAM_HOST[site]}/roles`}>Roles</ConsoleLink>
                      }
                    />
                  </li>
                  <li>
                    <Fill
                      text={t(
                        'Create Role → trusted entity {idp} → {type} → pick the provider you just added',
                      )}
                      idp={<span className="text-main">IdP</span>}
                      type={<span className="text-main">OIDC</span>}
                    />
                  </li>
                  <li>
                    <Fill
                      text={t('Add a condition on {sub} = {value} so only this team can assume it')}
                      sub={<span className="font-mono text-[11px]">oidc:sub</span>}
                      value={oidcValue(oidc?.subject)}
                    />
                  </li>
                  <li>
                    <Fill
                      text={t('Attach a policy covering ACK + ECS — {ack} + {ecs}, or {admin}')}
                      ack={<span className="font-mono text-[11px]">AliyunCSFullAccess</span>}
                      ecs={<span className="font-mono text-[11px]">AliyunECSReadOnlyAccess</span>}
                      admin={<span className="font-mono text-[11px]">AdministratorAccess</span>}
                    />
                  </li>
                  <li>
                    <Fill
                      text={t('Create it, then open the role and copy its {arn}')}
                      arn={<span className="text-main">ARN</span>}
                    />
                  </li>
                </StepList>
                <StepNote>
                  <Fill
                    text={t(
                      'Keep the trust policy the console generates — its action is {action}, which is what RAM grants to an OIDC provider. {api} is the STS API Nuphos calls, not a trust-policy action; changing the action to it makes the bind fail.',
                    )}
                    action={<span className="font-mono">sts:AssumeRole</span>}
                    api={<span className="font-mono">AssumeRoleWithOIDC</span>}
                  />
                </StepNote>
              </div>
            )}
            {i === 2 && (
              <div className="space-y-3">
                <Field
                  label={t('Label')}
                  hint={t('A friendly name to identify this Alibaba Cloud account.')}
                >
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => onLabelChange(e.target.value)}
                    placeholder="Acme Alibaba Cloud"
                    className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
                  />
                </Field>
                <Field
                  label={t('Role ARN')}
                  hint={t('The ARN of the RAM role you created in step 2.')}
                >
                  <input
                    type="text"
                    value={roleArn}
                    onChange={(e) => onRoleArnChange(e.target.value)}
                    placeholder="acs:ram::123456789012345:role/NuphosConnector"
                    className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
                  />
                </Field>
                <Field
                  label={t('OIDC Provider ARN')}
                  hint={t('The ARN of the RAM OIDC provider from step 1.')}
                >
                  <input
                    type="text"
                    value={oidcProviderArn}
                    onChange={(e) => onOidcProviderArnChange(e.target.value)}
                    placeholder="acs:ram::123456789012345:oidc-provider/nuphos"
                    className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
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
