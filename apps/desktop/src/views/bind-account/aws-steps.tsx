import { StepList, ConsoleLink, CopyableValue, Field } from './shared'

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
              In the AWS console, open{' '}
              <ConsoleLink href={AWS_CREATE_PROVIDER_URL}>IAM → Add identity provider</ConsoleLink>
            </li>
            <li>
              Provider type: <span className="text-main">OpenID Connect</span>
            </li>
            <li>
              Provider URL: <CopyableValue value="https://nuphos.ai" />
            </li>
            <li>
              Audience: <CopyableValue value="sts.amazonaws.com" />
            </li>
            <li>
              Click <span className="text-main">Add provider</span>
            </li>
          </StepList>
          <div className="text-[11.5px] text-tertiary">
            Already added <span className="font-mono">nuphos.ai</span> in this AWS account? Skip
            ahead with Next.
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <StepList>
            <li>
              In the AWS console, open{' '}
              <ConsoleLink href={AWS_CREATE_ROLE_URL}>IAM → Create role</ConsoleLink>
            </li>
            <li>
              Trusted entity type: <span className="text-main">Web identity</span>
            </li>
            <li>
              Identity provider: <span className="text-main">nuphos.ai</span> · Audience:{' '}
              <span className="text-main">sts.amazonaws.com</span>
            </li>
            <li>
              Click <span className="text-main">Add condition</span> — Key:{' '}
              <CopyableValue value="nuphos.ai:sub" /> · Condition:{' '}
              <span className="text-main">StringEquals</span> · Value:{' '}
              <CopyableValue value={`nuphos:team:${teamId}`} />
            </li>
            <li>
              Click <span className="text-main">Next</span>
            </li>
          </StepList>
          <div className="text-[11.5px] text-tertiary">
            The condition pins this role to your team — without it, any Nuphos team could assume the
            role.
          </div>
        </div>
      )}

      {step === 2 && purpose === 'operational' && (
        <div className="space-y-3">
          <div className="text-[12px] text-secondary leading-relaxed">
            On the <span className="text-main">Add permissions</span> page, choose what Nuphos is
            allowed to do in this account:
          </div>
          <ul className="text-[12px] text-secondary leading-relaxed space-y-2 list-disc list-inside marker:text-tertiary">
            <li>
              <span className="text-main">Start lean</span> — pick read-only policies for the
              services you actually use, e.g.{' '}
              <span className="font-mono text-[11px]">AmazonEC2ReadOnlyAccess</span>,{' '}
              <span className="font-mono text-[11px]">AmazonS3ReadOnlyAccess</span>.
            </li>
            <li>
              <span className="text-main">
                Or just <span className="font-mono text-[11px]">AdministratorAccess</span>
              </span>{' '}
              — simplest if this is a fresh / dedicated account, or you value speed over least
              privilege.
            </li>
          </ul>
          <div className="text-[11.5px] text-tertiary">
            Then click <span className="text-main">Next</span> in AWS.
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <StepList>
            <li>
              Role name: <CopyableValue value="NuphosRole" /> (or any name you like)
            </li>
            <li>
              Review the trust policy — it should show both the{' '}
              <span className="font-mono">aud</span> and <span className="font-mono">sub</span>{' '}
              conditions — then click <span className="text-main">Create role</span>
            </li>
          </StepList>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <div className="text-[12px] text-secondary leading-relaxed">
            Open the new role and copy its <span className="text-main">ARN</span> from the Summary
            card, then paste it here.
          </div>
          <Field
            label="IAM Role ARN"
            hint="The role Nuphos will assume in your account. Account ID is parsed from the ARN."
          >
            <input
              type="text"
              value={roleArn}
              onChange={(e) => onRoleArnChange(e.target.value)}
              placeholder="arn:aws:iam::123456789012:role/NuphosRole"
              className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
            />
          </Field>
        </div>
      )}
    </>
  )
}
