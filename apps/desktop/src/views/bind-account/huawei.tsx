import clsx from 'clsx'

import { t } from '../../i18n'

import { StepList, ConsoleLink, CopyableValue, Field, Fill } from './shared'
import { HUAWEI_STEPS } from './steps'

import type { HuaweiOidcInfo } from '../../types'

const HUAWEI_CREATE_PROVIDER_URL = 'https://console.huaweicloud.com/iam5/#/idp/create?type=oidc'
const HUAWEI_CREATE_AGENCY_URL = 'https://console.huaweicloud.com/iam5/#/agencies/create'
const HUAWEI_MY_CREDENTIAL_URL = 'https://console.huaweicloud.com/iam/#/myCredential'

const inputClass =
  'w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main'

export function HuaweiBindWizard({
  step,
  oidc,
  label,
  onLabelChange,
  domainId,
  onDomainIdChange,
  idpId,
  onIdpIdChange,
  agencyName,
  onAgencyNameChange,
}: {
  step: number
  oidc: HuaweiOidcInfo | null
  label: string
  onLabelChange: (v: string) => void
  domainId: string
  onDomainIdChange: (v: string) => void
  idpId: string
  onIdpIdChange: (v: string) => void
  agencyName: string
  onAgencyNameChange: (v: string) => void
}) {
  // Render the backend-provided value, or a muted placeholder until oidc-info
  // loads. Never fall back to hard-coded issuer/audience/subject — a wrong value
  // would guide the user to author a mismatched identity provider (fetch
  // failure is surfaced via toast where the fetch runs).
  const oidcValue = (v: string | undefined) =>
    v ? <CopyableValue value={v} /> : <span className="text-tertiary italic">{t('loading…')}</span>

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-1 mb-2">
          {HUAWEI_STEPS.map((title, i) => (
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
          {t('Step {n} of {total}', { n: step + 1, total: HUAWEI_STEPS.length })}
        </div>
        <div className="text-[13.5px] text-main font-medium">{HUAWEI_STEPS[step]}</div>
      </div>

      <div className="t-page-slide t-wizard-slide" data-page={step + 1}>
        {HUAWEI_STEPS.map((title, i) => (
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
                    <Fill
                      text={t('In the Huawei Cloud console, open {link}')}
                      link={
                        <ConsoleLink href={HUAWEI_CREATE_PROVIDER_URL}>
                          Create Identity Provider
                        </ConsoleLink>
                      }
                    />
                  </li>
                  <li>
                    <Fill
                      text={t("Type {type}, and give it a name you'll recognize")}
                      type={<span className="text-main">OIDC</span>}
                    />
                  </li>
                  <li>
                    <Fill
                      text={t('Identity provider URL: {value}')}
                      value={oidcValue(oidc?.issuer)}
                    />
                  </li>
                  <li>
                    <Fill text={t('Audience: {value}')} value={oidcValue(oidc?.audience)} />
                  </li>
                  <li>
                    {t(
                      "Save — Huawei Cloud fetches the signing keys from the identity provider URL itself, there's nothing to upload",
                    )}
                  </li>
                  <li>
                    <Fill
                      text={t(
                        "Note the provider's {name} (what you typed above — not the separate hex ID Huawei also shows), and your account ID from {link} — both go in the last step",
                      )}
                      name={<span className="text-main">{t('name')}</span>}
                      link={
                        <ConsoleLink href={HUAWEI_MY_CREDENTIAL_URL}>My Credentials</ConsoleLink>
                      }
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
                      text={t('In the Huawei Cloud console, open {link}')}
                      link={
                        <ConsoleLink href={HUAWEI_CREATE_AGENCY_URL}>
                          Create Trust Agency
                        </ConsoleLink>
                      }
                    />
                  </li>
                  <li>
                    <Fill
                      text={t(
                        'Agency Type: {agencyType}, Identity Provider Type: {idpType}, then pick the provider you created in step 1',
                      )}
                      agencyType={<span className="text-main">Identity Provider</span>}
                      idpType={<span className="text-main">OIDC</span>}
                    />
                  </li>
                  <li>
                    <Fill text={t('Audience: {value}')} value={oidcValue(oidc?.audience)} />
                  </li>
                  <li>
                    <Fill
                      text={t(
                        'Give it the permissions Nuphos should have (read-only is enough for browsing), scoped to {scope} — Nuphos requests an account-scoped credential, which a project-only agency cannot grant',
                      )}
                      scope={<span className="text-main">All resources</span>}
                    />
                  </li>
                  <li>
                    <Fill
                      text={t(
                        "Under {condition}, click {add} and add {claim} / {operator} equal to {subject}, alongside the {iss} condition already there — required, not optional: Nuphos's identity provider is shared across every customer, so without it anyone who registers the same audience could assume this agency too (Huawei's own form recommends this for a shared OIDC provider)",
                      )}
                      condition={<span className="text-main">Condition</span>}
                      add={<span className="text-main">Add</span>}
                      claim={<span className="font-mono text-[11px]">oidc:sub</span>}
                      operator={<span className="text-main">StringEquals</span>}
                      subject={oidcValue(oidc?.subject)}
                      iss={<span className="font-mono text-[11px]">oidc:iss</span>}
                    />
                  </li>
                </StepList>
                <div className="text-[11.5px] text-tertiary">
                  {t(
                    'The trust agency you create is exactly what Nuphos can do in your account — note its name, it goes in the last step.',
                  )}
                </div>
              </div>
            )}
            {i === 2 && (
              <div className="space-y-3">
                <Field
                  label={t('Label')}
                  hint={t('A friendly name to identify this Huawei Cloud account.')}
                >
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => onLabelChange(e.target.value)}
                    placeholder="Acme Huawei Cloud"
                    className={inputClass}
                  />
                </Field>
                <Field
                  label={t('Account ID')}
                  hint={t("The 32-character account ID on the console's My Credentials page.")}
                >
                  <input
                    type="text"
                    value={domainId}
                    onChange={(e) => onDomainIdChange(e.target.value)}
                    placeholder="0a1b2c3d4e5f60718293a4b5c6d7e8f9"
                    className={inputClass}
                  />
                </Field>
                <Field
                  label={t('Identity provider name')}
                  hint={t(
                    'The name you gave the provider in step 1 — not the separate hex ID Huawei also shows.',
                  )}
                >
                  <input
                    type="text"
                    value={idpId}
                    onChange={(e) => onIdpIdChange(e.target.value)}
                    placeholder="nuphos"
                    className={inputClass}
                  />
                </Field>
                <Field
                  label={t('Trust agency name')}
                  hint={t('The name of the trust agency you assigned in step 2.')}
                >
                  <input
                    type="text"
                    value={agencyName}
                    onChange={(e) => onAgencyNameChange(e.target.value)}
                    placeholder="nuphos-readonly"
                    className={inputClass}
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
