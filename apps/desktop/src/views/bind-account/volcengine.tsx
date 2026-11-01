import clsx from 'clsx'

import { t } from '../../i18n'

import { StepList, ConsoleLink, CopyableValue, Field, Fill } from './shared'
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
    v ? <CopyableValue value={v} /> : <span className="text-tertiary italic">{t('loading…')}</span>

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
          {t('Step {n} of {total}', { n: step + 1, total: VOLC_STEPS.length })}
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
                    <Fill
                      text={t('In the Volcengine console, open {link}')}
                      link={
                        <ConsoleLink href={VOLC_CREATE_PROVIDER_URL}>
                          IAM → Identity Providers
                        </ConsoleLink>
                      }
                    />
                  </li>
                  <li>
                    <Fill
                      text={t('Add an {type} provider, SSO type {sso}')}
                      type={<span className="text-main">OIDC</span>}
                      sso={<span className="text-main">Role SSO</span>}
                    />
                  </li>
                  <li>
                    <Fill text={t('Issuer URL: {value}')} value={oidcValue(oidc?.issuer)} />
                  </li>
                  <li>
                    <Fill
                      text={t('Fingerprint: click {button}')}
                      button={<span className="text-main">Get it now</span>}
                    />
                  </li>
                  <li>
                    <Fill text={t('Client ID: {value}')} value={oidcValue(oidc?.audience)} />
                  </li>
                  <li>
                    <Fill
                      text={t('Leave {field} default, then Submit')}
                      field={<span className="text-main">Min Issue Time</span>}
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
                      text={t('In the Volcengine console, open {link}')}
                      link={<ConsoleLink href={VOLC_CREATE_ROLE_URL}>IAM → Roles</ConsoleLink>}
                    />
                  </li>
                  <li>
                    <Fill
                      text={t(
                        'Create Role → trust identity {idp} → {type} → pick the provider you just added',
                      )}
                      idp={<span className="text-main">Identity provider</span>}
                      type={<span className="text-main">OIDC</span>}
                    />
                  </li>
                  <li>
                    <Fill
                      text={t(
                        'Attach a policy covering VKE + ECS — {vke}, or {admin} for a dedicated account',
                      )}
                      vke={<span className="font-mono text-[11px]">VKEFullAccess</span>}
                      admin={<span className="font-mono text-[11px]">AdministratorAccess</span>}
                    />
                  </li>
                  <li>
                    <Fill
                      text={t('Create it, then open the role and copy its {trn}')}
                      trn={<span className="text-main">TRN</span>}
                    />
                  </li>
                </StepList>
                <div className="text-[11.5px] text-tertiary">
                  {t(
                    'IAM only covers the control plane — the next step grants this role access inside your VKE clusters.',
                  )}
                </div>
              </div>
            )}
            {i === 2 && (
              <div className="space-y-3">
                <div className="text-[11.5px] text-tertiary">
                  {t(
                    'Only needed for VKE (Kubernetes) clusters — no clusters, or ECS only? Hit Next and skip this step.',
                  )}
                </div>
                <StepList>
                  <li>
                    <Fill
                      text={t('In the VKE console, open {link}')}
                      link={
                        <ConsoleLink href={VOLC_ROLE_AUTH_URL}>
                          Authorizations → Role authorization
                        </ConsoleLink>
                      }
                    />
                  </li>
                  <li>
                    <Fill
                      text={t('Sign in as the {who} — only they can grant in-cluster RBAC')}
                      who={
                        <span className="text-main">{t('cluster creator or root account')}</span>
                      }
                    />
                  </li>
                  <li>
                    <Fill
                      text={t('Enter the exact {role} you created in step 2, then continue')}
                      role={<span className="text-main">{t('role name')}</span>}
                    />
                  </li>
                  <li>
                    <Fill
                      text={t(
                        '{action} — pick your clusters (or Account All Resources), a namespace scope, and an access right (read-only is enough for browsing)',
                      )}
                      action={<span className="text-main">Add role authorization</span>}
                    />
                  </li>
                  <li>{t('Repeat for each region that has clusters')}</li>
                </StepList>
                <div className="text-[11.5px] text-tertiary">
                  {t(
                    'Skipping this? Clusters still bind, but their contents stay forbidden — Nuphos will show this same guidance when you open one.',
                  )}
                </div>
              </div>
            )}
            {i === 3 && (
              <div className="space-y-3">
                <Field
                  label={t('Label')}
                  hint={t('A friendly name to identify this Volcengine account.')}
                >
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => onLabelChange(e.target.value)}
                    placeholder="Acme Volcengine"
                    className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
                  />
                </Field>
                <Field label={t('Role TRN')} hint={t('The TRN of the role you created in step 2.')}>
                  <input
                    type="text"
                    value={roleTrn}
                    onChange={(e) => onRoleTrnChange(e.target.value)}
                    placeholder="trn:iam::2100000000:role/Zeabur"
                    className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
                  />
                </Field>
                <div className="text-[11.5px] text-tertiary">
                  <Fill
                    text={t(
                      "Optional: pin the role's trust policy to subject {subject} so only this team can assume it.",
                    )}
                    subject={oidcValue(oidc?.subject)}
                  />
                </div>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
