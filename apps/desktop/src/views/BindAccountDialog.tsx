import { useRef, useState } from 'react'

import { api } from '../api'
import { Modal } from '../components/Modal'
import { toast } from '../components/ui/toast'
import { t } from '../i18n'
import { isCloudCliProvider } from '../lib/cloudCli'

import { BindDialogBody } from './bind-account/body'
import { CloudCliSetupChoice } from './bind-account/cli-setup'
import { BindDialogFooter } from './bind-account/footer'
import { SHAREABLE_PROVIDERS } from './bind-account/share'
import { BindShareField } from './bind-account/share-field'
import { submitBind } from './bind-account/submit'
import { useBindAccountState, useBindDialogEffects } from './bind-account/use-bind-state'
import { useCloudCliCheck } from './bind-account/use-cloud-cli-check'
import { bindFormValid, providerLabelOf } from './bind-account/validity'
import { useResetOnKey } from './useResetOnKey'

import type { Provider } from './bind-account/constants'

export { StepList, ConsoleLink, CopyableValue, Field } from './bind-account/shared'

type Props = {
  open: boolean
  teamId: string
  initialProvider?: Provider
  onClose: () => void
  onBound: () => void
  onOpenAgentChat?: (prompt: string) => void
}

export function BindAccountDialog({
  open,
  teamId,
  initialProvider = 'aws',
  onClose,
  onBound,
  onOpenAgentChat,
}: Props) {
  const st = useBindAccountState(initialProvider)
  const [shareList, setShareList] = useState<string[] | null>(null)

  useResetOnKey(`${String(open)}|${initialProvider}`, () => {
    if (open) st.setProvider(initialProvider)
  })
  useResetOnKey(`${String(open)}|${st.provider}`, () => setShareList(null))
  useBindDialogEffects(st, open, teamId)

  const { provider, submitting, cloudflareConnecting, reset, error } = st

  const cliCheck = useCloudCliCheck(open && Boolean(onOpenAgentChat), provider, teamId)
  // Closing the dialog cancels the attempt in flight; its rejection must not
  // toast, and a late result must not touch the next attempt.
  const cloudflareAttempt = useRef(0)

  function close() {
    if (submitting) return
    if (cloudflareConnecting) {
      cloudflareAttempt.current += 1
      void api.atlasCancelCloudflareConnect(teamId).catch(() => {})
      st.setCloudflareConnecting(false)
    }
    reset()
    onClose()
  }

  async function connectCloudflareOAuth(scopes?: string[]) {
    const attempt = ++cloudflareAttempt.current

    st.setCloudflareConnecting(true)
    try {
      // Resolves when Cloudflare redirects back through the backend and the
      // desktop receives the nuphos://cloudflare-callback deep link.
      await api.atlasStartCloudflareConnect(teamId, scopes)
      if (attempt !== cloudflareAttempt.current) return
      reset()
      onBound()
      onClose()
    } catch (e) {
      if (attempt !== cloudflareAttempt.current) return
      toast.apiError(t('Could not connect {name}', { name: 'Cloudflare' }), e, {
        fallback: t('Check the details and your connection, then try again.'),
      })
    } finally {
      if (attempt === cloudflareAttempt.current) st.setCloudflareConnecting(false)
    }
  }

  const valid = bindFormValid(st)
  const providerLabel = providerLabelOf(provider)

  const showFooter = provider !== 'cloudflare' && !cliCheck.visible
  const footerContent = showFooter ? (
    <BindDialogFooter
      st={st}
      valid={valid}
      onSubmit={() =>
        void submitBind(st, { teamId, onBound, onClose, ...(shareList ? { shareList } : {}) })
      }
      onCloseRequest={close}
    />
  ) : undefined

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('Connect {name}', { name: providerLabel })}
      description={
        cliCheck.visible
          ? undefined
          : t('Grant Nuphos access to this {name} integration.', { name: providerLabel })
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
          />
        ) : (
          <BindDialogBody
            st={st}
            teamId={teamId}
            onConnectCloudflare={(scopes) => void connectCloudflareOAuth(scopes)}
          />
        )}
        {showFooter && SHAREABLE_PROVIDERS.has(provider) && (
          <BindShareField
            teamId={teamId}
            provider={provider}
            value={shareList}
            onChange={setShareList}
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
