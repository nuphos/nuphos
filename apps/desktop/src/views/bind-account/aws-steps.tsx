import { t } from '../../i18n'

import { StepList, ConsoleLink, CopyableValue, Field, Fill } from './shared'

const AWS_CREATE_PROVIDER_URL =
  'https://us-east-1.console.aws.amazon.com/iam/home#/identity_providers/create'

const AWS_CREATE_ROLE_URL = 'https://us-east-1.console.aws.amazon.com/iam/home#/roles/create'

export function AwsWizardStepContent({
  step,
  teamId,
  roleArn,
  onRoleArnChange,
  purpose,
}: {
  step: number
  teamId: string
  roleArn: string
  onRoleArnChange: (v: string) => void
  purpose: 'operational'
}) {
  return (
    <>
      {step === 0 && (
        <div className="space-y-3">
          <StepList>
            <li>
              <Fill
                text={t('In the AWS console, open {link}')}
                link={
                  <ConsoleLink href={AWS_CREATE_PROVIDER_URL}>
                    IAM → Add identity provider
                  </ConsoleLink>
                }
              />
            </li>
            <li>
              <Fill
                text={t('Provider type: {value}')}
                value={<span className="text-main">OpenID Connect</span>}
              />
            </li>
            <li>
              <Fill
                text={t('Provider URL: {value}')}
                value={<CopyableValue value="https://nuphos.ai" />}
              />
            </li>
            <li>
              <Fill
                text={t('Audience: {value}')}
                value={<CopyableValue value="sts.amazonaws.com" />}
              />
            </li>
            <li>
              <Fill
                text={t('Click {button}')}
                button={<span className="text-main">Add provider</span>}
              />
            </li>
          </StepList>
          <div className="text-[11.5px] text-tertiary">
            <Fill
              text={t('Already added {provider} in this AWS account? Skip ahead with Next.')}
              provider={<span className="font-mono">nuphos.ai</span>}
            />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <StepList>
            <li>
              <Fill
                text={t('In the AWS console, open {link}')}
                link={<ConsoleLink href={AWS_CREATE_ROLE_URL}>IAM → Create role</ConsoleLink>}
              />
            </li>
            <li>
              <Fill
                text={t('Trusted entity type: {value}')}
                value={<span className="text-main">Web identity</span>}
              />
            </li>
            <li>
              <Fill
                text={t('Identity provider: {provider} · Audience: {audience}')}
                provider={<span className="text-main">nuphos.ai</span>}
                audience={<span className="text-main">sts.amazonaws.com</span>}
              />
            </li>
            <li>
              <Fill
                text={t('Click {button} — Key: {field} · Condition: {condition} · Value: {value}')}
                button={<span className="text-main">Add condition</span>}
                field={<CopyableValue value="nuphos.ai:sub" />}
                condition={<span className="text-main">StringEquals</span>}
                value={<CopyableValue value={`nuphos:team:${teamId}`} />}
              />
            </li>
            <li>
              <Fill text={t('Click {button}')} button={<span className="text-main">Next</span>} />
            </li>
          </StepList>
          <div className="text-[11.5px] text-tertiary">
            {t(
              'The condition pins this role to your team — without it, any Nuphos team could assume the role.',
            )}
          </div>
        </div>
      )}

      {step === 2 && purpose === 'operational' && (
        <div className="space-y-3">
          <div className="text-[12px] text-secondary leading-relaxed">
            <Fill
              text={t('On the {page} page, choose what Nuphos is allowed to do in this account:')}
              page={<span className="text-main">Add permissions</span>}
            />
          </div>
          <ul className="text-[12px] text-secondary leading-relaxed space-y-2 list-disc list-inside marker:text-tertiary">
            <li>
              <Fill
                text={t(
                  '{lean} — pick read-only policies for the services you actually use, e.g. {ec2}, {s3}.',
                )}
                lean={<span className="text-main">{t('Start lean')}</span>}
                ec2={<span className="font-mono text-[11px]">AmazonEC2ReadOnlyAccess</span>}
                s3={<span className="font-mono text-[11px]">AmazonS3ReadOnlyAccess</span>}
              />
            </li>
            <li>
              <Fill
                text={t(
                  '{admin} — simplest if this is a fresh / dedicated account, or you value speed over least privilege.',
                )}
                admin={
                  <span className="text-main">
                    <Fill
                      text={t('Or just {policy}')}
                      policy={<span className="font-mono text-[11px]">AdministratorAccess</span>}
                    />
                  </span>
                }
              />
            </li>
          </ul>
          <div className="text-[11.5px] text-tertiary">
            <Fill
              text={t('Then click {button} in AWS.')}
              button={<span className="text-main">Next</span>}
            />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <StepList>
            <li>
              <Fill
                text={t('Role name: {value} (or any name you like)')}
                value={<CopyableValue value="NuphosRole" />}
              />
            </li>
            <li>
              <Fill
                text={t(
                  'Review the trust policy — it should show both the {aud} and {sub} conditions — then click {button}',
                )}
                aud={<span className="font-mono">aud</span>}
                sub={<span className="font-mono">sub</span>}
                button={<span className="text-main">Create role</span>}
              />
            </li>
          </StepList>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <div className="text-[12px] text-secondary leading-relaxed">
            <Fill
              text={t(
                'Open the new role and copy its {arn} from the Summary card, then paste it here.',
              )}
              arn={<span className="text-main">ARN</span>}
            />
          </div>
          <Field
            label={t('IAM Role ARN')}
            hint={t(
              'The role Nuphos will assume in your account. Account ID is parsed from the ARN.',
            )}
          >
            <input
              type="text"
              value={roleArn}
              onChange={(e) => onRoleArnChange(e.target.value)}
              placeholder="arn:aws:iam::123456789012:role/NuphosRole"
              className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
            />
          </Field>
        </div>
      )}
    </>
  )
}
