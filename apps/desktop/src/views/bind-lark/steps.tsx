import clsx from 'clsx'

import {
  WizardConsoleLink,
  WizardCopyableBlock,
  WizardCopyableValue,
  WizardDownloadLink,
  WizardExampleImage,
  WizardStep,
  WizardStepList,
} from '../../components/ConnectorWizard'

import { CREATE_APP_URL, LARK_SUBSCRIBE_EVENTS, larkAppPageUrl } from './console'
import { Field, Input, WebhookRow } from './controls'

import type { LarkDomain } from '../../types'

// Batch scope-import payload for the console's "Batch import/export scopes"
// dialog — all tenant-level scopes the bot needs, in one paste.
const SCOPES_IMPORT_JSON = `{
  "scopes": {
    "tenant": [
      "im:message:send_as_bot",
      "im:message.group_at_msg:readonly",
      "im:message.p2p_msg:readonly",
      "im:chat:readonly",
      "contact:contact.base:readonly"
    ],
    "user": []
  }
}`

export function SiteStep({
  domain,
  onDomainChange,
}: {
  domain: LarkDomain
  onDomainChange: (d: LarkDomain) => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-secondary">
        Feishu (China) and Lark (Global) are separate platforms. Pick the one your organization uses
        — it decides which developer console and API host Nuphos talks to.
      </p>
      <div className="flex gap-2">
        {(['feishu', 'larksuite'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onDomainChange(d)}
            className={clsx(
              'flex flex-1 flex-col items-start gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors',
              domain === d
                ? 'border-zViolet-500 bg-zViolet-500/10'
                : 'border-zGray-800 hover:border-zGray-700',
            )}
          >
            <span
              className={clsx(
                'text-[13px] font-medium',
                domain === d ? 'text-main' : 'text-secondary',
              )}
            >
              {d === 'feishu' ? 'Feishu 飞书' : 'Lark'}
            </span>
            <span className="font-mono text-[11px] text-tertiary">
              {d === 'feishu' ? 'open.feishu.cn' : 'open.larksuite.com'}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function CreateAppStep({ domain }: { domain: LarkDomain }) {
  return (
    <div className="space-y-3">
      <WizardConsoleLink href={CREATE_APP_URL[domain]}>
        Open the {domain === 'feishu' ? 'Feishu' : 'Lark'} console → Create app
      </WizardConsoleLink>
      <WizardStepList>
        <li>
          Click <span className="text-main">Create custom app</span>.
        </li>
        <li>
          Set the app name to <WizardCopyableValue value="Nuphos" /> and the description to{' '}
          <WizardCopyableValue value="The agent workspace for your team." />.
        </li>
        <li>
          Use the Nuphos logo as its icon:
          <div className="mt-2">
            <WizardDownloadLink href="/logo-white-bg.svg" download="nuphos-logo.svg">
              Download Nuphos logo
            </WizardDownloadLink>
          </div>
        </li>
        <li>Open the new app and keep it handy — the next steps need its credentials.</li>
      </WizardStepList>
      <p className="text-[11.5px] leading-relaxed text-tertiary">
        A custom app belongs to your own organization and needs no marketplace review — only your
        workspace members can use it.
      </p>
    </div>
  )
}

export function CredentialsStep({
  domain,
  appId,
  appSecret,
  onAppId,
  onAppSecret,
  appIdValid,
}: {
  domain: LarkDomain
  appId: string
  appSecret: string
  onAppId: (v: string) => void
  onAppSecret: (v: string) => void
  appIdValid: boolean
}) {
  return (
    <div className="space-y-3.5">
      <WizardStepList>
        <li>
          In the left sidebar, open{' '}
          <span className="text-main">Basic Info → Credentials &amp; Basic Info</span> (
          {domain === 'feishu' ? 'Feishu' : 'Lark'} site).
        </li>
        <li>Copy the App ID and App Secret from the Credentials card into the fields below.</li>
      </WizardStepList>
      <Field label="App ID">
        <Input value={appId} onChange={onAppId} placeholder="cli_xxxxxxxxxxxxxxxx" mono />
        {appId.trim().length > 0 && !appIdValid && (
          <p className="mt-1 text-[11px] text-error">App ID should start with cli_.</p>
        )}
      </Field>
      <Field label="App Secret">
        <Input value={appSecret} onChange={onAppSecret} placeholder="App Secret" mono secret />
      </Field>
    </div>
  )
}

export function PermissionsStep({ domain, appId }: { domain: LarkDomain; appId: string }) {
  return (
    <div className="space-y-3">
      <WizardConsoleLink href={larkAppPageUrl(domain, appId, 'auth')}>
        Open your app’s Permissions &amp; Scopes page
      </WizardConsoleLink>
      <WizardStepList>
        <li>
          Open <span className="text-main">Permissions &amp; Scopes</span>, then{' '}
          <span className="text-main">Batch import/export scopes → Import</span>.
        </li>
        <li>Paste this JSON, then click Next, Review New Scopes and apply:</li>
      </WizardStepList>
      <WizardCopyableBlock value={SCOPES_IMPORT_JSON} />
      <p className="text-[11.5px] leading-relaxed text-tertiary">
        These let Nuphos reply as the bot, list the groups it’s in, and read a sender’s display
        name. Members link their own account by DMing the bot a pairing code.
      </p>
    </div>
  )
}

export function EventEncryptStep({
  domain,
  appId,
  encryptKey,
  onEncryptKey,
}: {
  domain: LarkDomain
  appId: string
  encryptKey: string
  onEncryptKey: (v: string) => void
}) {
  return (
    <div className="space-y-3.5">
      <div className="space-y-2">
        <WizardConsoleLink href={larkAppPageUrl(domain, appId, 'event')}>
          Open your app’s Events &amp; Callbacks page
        </WizardConsoleLink>
        <WizardStepList inline>
          <li>
            Open the <span className="text-main">Encryption Strategy</span> tab.
          </li>
          <li>
            Click the reset icon next to <span className="text-main">Encrypt Key</span> to generate
            one, then paste it below. You’ll set the request URL and subscribe to events after
            connecting.
          </li>
        </WizardStepList>
      </div>
      <Field label="Encrypt Key">
        <Input value={encryptKey} onChange={onEncryptKey} placeholder="Encrypt Key" mono secret />
      </Field>
      <p className="text-[11.5px] leading-relaxed text-tertiary">
        The Encrypt Key is required — Nuphos uses it to verify and decrypt inbound events, and fails
        closed without it.
      </p>
    </div>
  )
}

export function WebhookEventsStep({
  webhookUrl,
  domain,
  appId,
}: {
  webhookUrl: string
  domain: LarkDomain
  appId: string
}) {
  return (
    <WizardStep
      example={
        <WizardExampleImage
          src="/lark-event-config-example.png"
          alt="Event Configuration tab: set Subscription mode to 'Send notifications to developer's server', then paste the Request URL"
        />
      }
    >
      <div className="space-y-3">
        <WizardConsoleLink href={larkAppPageUrl(domain, appId, 'event')}>
          Open your app’s Events &amp; Callbacks page
        </WizardConsoleLink>
        <WizardStepList>
          <li>
            On the <span className="text-main">Event Configuration</span> tab, set{' '}
            <span className="text-main">Subscription mode</span> to{' '}
            <span className="text-main">Send notifications to developer’s server</span> (not the
            default persistent connection).
          </li>
          <li>
            Paste this into <span className="text-main">Request URL</span> and save:
            <div className="mt-2">
              <WebhookRow url={webhookUrl} />
            </div>
          </li>
          <li>
            Then subscribe to all {LARK_SUBSCRIBE_EVENTS.length} of these events:{' '}
            {LARK_SUBSCRIBE_EVENTS.map((ev, i) => (
              <span key={ev}>
                {i > 0 && (i === LARK_SUBSCRIBE_EVENTS.length - 1 ? ', and ' : ', ')}
                <WizardCopyableValue value={ev} />
              </span>
            ))}
            .
          </li>
        </WizardStepList>
      </div>
    </WizardStep>
  )
}

export function PublishStep() {
  return (
    <WizardStep
      example={
        <WizardExampleImage
          src="/lark-publish-example.png"
          alt="Create Version button in the top banner of the Lark Developer console (Version Management & Release)"
          objectPosition="right top"
        />
      }
    >
      <WizardStepList>
        <li>
          <span className="text-main">Create a version to publish it.</span> Everything you
          configured — scopes and events — stays pending until the app is published. Click{' '}
          <span className="text-main">Create Version</span> in the banner at the top of the app (or{' '}
          <span className="text-main">Version Management &amp; Release</span> in the sidebar),
          submit it for release, and wait until it goes live. The bot won’t respond until the
          version is published.
        </li>
        <li>
          Add the bot to a Feishu / Lark group — it links automatically and shows up under Groups
          here. Then <span className="text-main">@mention Nuphos</span> in that group, or DM the bot
          directly, and it replies.
        </li>
      </WizardStepList>
    </WizardStep>
  )
}
