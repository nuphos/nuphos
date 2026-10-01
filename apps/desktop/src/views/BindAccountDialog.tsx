import { api } from '../api'
import { Modal } from '../components/Modal'
import { toast } from '../components/ui/toast'
import { isCloudCliProvider } from '../lib/cloudCli'

import { BindDialogBody } from './bind-account/body'
import { CloudCliSetupChoice } from './bind-account/cli-setup'
import { BindDialogFooter } from './bind-account/footer'
import { submitBind } from './bind-account/submit'
import { useBindAccountState, useBindDialogEffects } from './bind-account/use-bind-state'
import { useCloudCliCheck } from './bind-account/use-cloud-cli-check'
import { bindFormValid, providerLabelOf } from './bind-account/validity'
import { useResetOnKey } from './useResetOnKey'

import type { Provider } from './bind-account/constants'

export { StepList, ConsoleLink, CopyableValue, Field } from './bind-account/shared'
export { AwsWizardStepContent } from './bind-account/aws-steps'
export { AzureWizardStepContent } from './bind-account/azure-steps'
export { GcpWizardStepContent } from './bind-account/gcp-steps'

type Props = {
  open: boolean
  teamId: string
  initialProvider?: Provider
  onClose: () => void
  onBound: () => void
  onOpenAgentChat?: (prompt: string) => void
  /** This bind is the team's first, driven by the guide. The permissions step
   *  then asks for cost read-only and nothing else, rather than laying out the
   *  usual menu that ends at AdministratorAccess. */
  firstRun?: boolean
}

export function BindAccountDialog({
  open,
  teamId,
  initialProvider = 'aws',
  onClose,
  onBound,
  onOpenAgentChat,
  firstRun = false,
}: Props) {
  const st = useBindAccountState(initialProvider)

  useResetOnKey(`${String(open)}|${initialProvider}`, () => {
    if (open) st.setProvider(initialProvider)
  })
  useBindDialogEffects(st, open, teamId)

  const { provider, submitting, cloudflareConnecting, reset, error } = st

  const cliCheck = useCloudCliCheck(open && Boolean(onOpenAgentChat), provider, teamId)

  function close() {
    if (submitting) return
    if (cloudflareConnecting) {
      void api.atlasCancelCloudflareConnect(teamId).catch(() => {})
      st.setCloudflareConnecting(false)
    }
    reset()
    onClose()
  }

  async function connectCloudflareOAuth(scopes?: string[]) {
    st.setCloudflareConnecting(true)
    try {
      // Resolves when Cloudflare redirects back through the backend and the
      // desktop receives the nuphos://cloudflare-callback deep link.
      await api.atlasStartCloudflareConnect(teamId, scopes)
      reset()
      onBound()
      onClose()
    } catch (e) {
      toast.apiError('Cloudflare connection failed', e, {
        fallback: 'Check the details and your connection, then try again.',
      })
    } finally {
      st.setCloudflareConnecting(false)
    }
  }

  const valid = bindFormValid(st)
  const providerLabel = providerLabelOf(provider)

  const showFooter = provider !== 'cloudflare' && !cliCheck.visible
  const footerContent = showFooter ? (
    <BindDialogFooter
      st={st}
      valid={valid}
      onSubmit={() => void submitBind(st, { teamId, onBound, onClose })}
      onCloseRequest={close}
    />
  ) : undefined

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Connect ${providerLabel}`}
      description={
        cliCheck.visible ? undefined : `Grant Nuphos access to this ${providerLabel} integration.`
      }
      width={500}
      footer={footerContent}
    >
      <div className="px-5 py-4 selectable">
        {cliCheck.visible && isCloudCliProvider(provider) && onOpenAgentChat ? (
          <CloudCliSetupChoice
            provider={provider}
            teamId={teamId}
            check={cliCheck}
            onOpenAgentChat={onOpenAgentChat}
            onStarted={close}
            firstRun={firstRun}
          />
        ) : (
          <BindDialogBody
            st={st}
            teamId={teamId}
            firstRun={firstRun}
            onConnectCloudflare={(scopes) => void connectCloudflareOAuth(scopes)}
          />
        )}

        {error && (
          <div className="mt-3 px-3 py-2 rounded-md bg-error/10 text-error text-[12.5px]">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
