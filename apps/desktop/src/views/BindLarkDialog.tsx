import { faSpinner } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useState } from 'react'

import { api } from '../api'
import { WizardExampleImage, WizardStep, WizardStepBar } from '../components/ConnectorWizard'
import { Modal } from '../components/Modal'
import { toast } from '../components/ui/toast'

import {
  CreateAppStep,
  CredentialsStep,
  EventEncryptStep,
  PermissionsStep,
  PublishStep,
  SiteStep,
  WebhookEventsStep,
} from './bind-lark/steps'
import { useResetOnKey } from './useResetOnKey'

import type { LarkDomain } from '../types'

type Props = {
  open: boolean
  teamId: string
  onClose: () => void
  onBound: () => void
  // 'reinstall' rebinds an already-connected team with fresh credentials.
  mode?: 'install' | 'reinstall'
}

const APP_ID_RE = /^cli_[a-z0-9]+$/i
const STEPS = [
  'Site',
  'Create app',
  'Credentials',
  'Permissions',
  'Encryption',
  'Webhook & events',
  'Publish & go live',
]

export function BindLarkDialog({ open, teamId, onClose, onBound, mode = 'install' }: Props) {
  const reinstall = mode === 'reinstall'
  const [step, setStep] = useState(0)
  const [domain, setDomain] = useState<LarkDomain>('feishu')
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [encryptKey, setEncryptKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null)
  // After credentials save (webhookUrl set), the wizard has two more sub-steps:
  // 0 = Webhook & events (configure subscription), 1 = Publish & go live.
  const [doneStep, setDoneStep] = useState(0)

  // Reset on close so a reopen starts clean.
  useResetOnKey(String(open), () => {
    if (open) return
    setStep(0)
    setDomain('feishu')
    setAppId('')
    setAppSecret('')
    setEncryptKey('')
    setSaving(false)
    setWebhookUrl(null)
    setDoneStep(0)
  })

  const appIdValid = APP_ID_RE.test(appId.trim())
  const canContinueCreds = appIdValid && appSecret.trim().length > 0
  const canSubmit = canContinueCreds && encryptKey.trim().length > 0 && !saving

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    try {
      const { webhookUrl: url } = await api.atlasBindLark(teamId, {
        appId: appId.trim(),
        appSecret: appSecret.trim(),
        encryptKey: encryptKey.trim(),
        domain,
      })

      setWebhookUrl(url)
      onBound()
    } catch (e) {
      toast.apiError(reinstall ? 'Could not reconnect Lark' : 'Could not connect Lark', e, {
        fallback: 'Check the credentials and your connection, then try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={reinstall ? 'Reconnect Lark' : 'Connect Lark (Feishu)'}
      description={
        webhookUrl
          ? 'Credentials saved. Last step — paste the URL below back into your app’s Event Subscription request URL, then publish a version.'
          : 'Register your own custom app in the Feishu / Lark developer console, then paste its credentials here. Nuphos never asks you to publish an app to the marketplace.'
      }
      width={640}
      // A stray click outside must not silently end the wizard — pre-bind it
      // wipes typed credentials, post-bind it hides the events the user still
      // has to subscribe to.
      closeOnBackdrop={false}
    >
      <div className="px-5 py-5 selectable">
        <WizardStepBar steps={STEPS} current={webhookUrl ? 5 + doneStep : step} />
        {webhookUrl ? (
          doneStep === 0 ? (
            <WebhookEventsStep webhookUrl={webhookUrl} domain={domain} appId={appId} />
          ) : (
            <PublishStep />
          )
        ) : (
          <>
            {step === 0 && <SiteStep domain={domain} onDomainChange={setDomain} />}
            {step === 1 && (
              <WizardStep
                example={
                  <WizardExampleImage
                    src="/lark-create-app-example.png"
                    alt="Create custom app form filled with the Nuphos name, description, and icon"
                  />
                }
              >
                <CreateAppStep domain={domain} />
              </WizardStep>
            )}
            {step === 2 && (
              <WizardStep
                example={
                  <WizardExampleImage
                    src="/lark-credentials-example.png"
                    alt="Credentials & Basic Info page showing where to copy the App ID and App Secret"
                  />
                }
              >
                <CredentialsStep
                  domain={domain}
                  appId={appId}
                  appSecret={appSecret}
                  onAppId={setAppId}
                  onAppSecret={setAppSecret}
                  appIdValid={appIdValid}
                />
              </WizardStep>
            )}
            {step === 3 && (
              <WizardStep
                example={
                  <WizardExampleImage
                    src="/lark-permissions-example.png"
                    alt="Batch import/export scopes dialog with the scopes JSON pasted"
                  />
                }
              >
                <PermissionsStep domain={domain} appId={appId} />
              </WizardStep>
            )}
            {step === 4 && (
              <WizardStep
                example={
                  <WizardExampleImage
                    src="/lark-event-encryption-example.png"
                    alt="Events & Callbacks → Encryption Strategy, showing the Encrypt Key"
                  />
                }
              >
                <EventEncryptStep
                  domain={domain}
                  appId={appId}
                  encryptKey={encryptKey}
                  onEncryptKey={setEncryptKey}
                />
              </WizardStep>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-zGray-800/60 px-5 py-4">
        <div>
          {!webhookUrl && (
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-md border border-zGray-800 px-3 text-[12.5px] font-medium text-secondary transition-colors hover:border-zGray-700 hover:text-main"
            >
              Cancel
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!webhookUrl && step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="h-9 rounded-md px-3 text-[12.5px] font-medium text-secondary transition-colors hover:text-main"
            >
              Back
            </button>
          )}
          {!webhookUrl && step < 4 && (
            <button
              type="button"
              disabled={step === 2 && !canContinueCreds}
              onClick={() => setStep((s) => s + 1)}
              className="h-9 rounded-md bg-zViolet-500 px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-zViolet-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          )}
          {!webhookUrl && step === 4 && (
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void submit()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-zViolet-500 px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-zViolet-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && <FontAwesomeIcon icon={faSpinner} className="h-3 w-3 animate-spin" />}
              {reinstall ? 'Reconnect' : 'Connect'}
            </button>
          )}
          {webhookUrl && doneStep === 1 && (
            <button
              type="button"
              onClick={() => setDoneStep(0)}
              className="h-9 rounded-md px-3 text-[12.5px] font-medium text-secondary transition-colors hover:text-main"
            >
              Back
            </button>
          )}
          {webhookUrl && doneStep === 0 && (
            <button
              type="button"
              onClick={() => setDoneStep(1)}
              className="h-9 rounded-md bg-zViolet-500 px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-zViolet-400"
            >
              Continue
            </button>
          )}
          {webhookUrl && doneStep === 1 && (
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-md border border-zGray-800 px-3 text-[12.5px] font-medium text-secondary transition-colors hover:border-zGray-700 hover:text-main"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
