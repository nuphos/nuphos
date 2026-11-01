import {
  WizardConsoleLink,
  WizardCopyableBlock,
  WizardCopyableValue,
  WizardDownloadLink,
  WizardExampleImage,
  WizardStep,
  WizardStepList,
} from '../../components/ConnectorWizard'
import { t } from '../../i18n'

import { CREATE_APP_URL, LARK_SUBSCRIBE_EVENTS, larkAppPageUrl } from './console'
import { Field, Input, WebhookRow } from './controls'
import { hl, rich, SCOPES_IMPORT_JSON, SITE } from './larkText'

import type { LarkDomain } from '../../types'

export { SiteStep } from './controls'

export function CreateAppStep({ domain }: { domain: LarkDomain }) {
  return (
    <div className="space-y-3">
      <WizardConsoleLink href={CREATE_APP_URL[domain]}>
        {t('Open the {site} console → Create app', { site: SITE[domain] })}
      </WizardConsoleLink>
      <WizardStepList>
        <li>{rich(t('Click {action}.'), { action: hl(t('Create custom app')) })}</li>
        <li>
          {rich(t('Set the app name to {name} and the description to {description}.'), {
            name: <WizardCopyableValue value="Nuphos" />,
            description: <WizardCopyableValue value="The agent workspace for your team." />,
          })}
        </li>
        <li>
          {t('Use the Nuphos logo as its icon:')}
          <div className="mt-2">
            <WizardDownloadLink href="/logo-white-bg.svg" download="nuphos-logo.svg">
              {t('Download Nuphos logo')}
            </WizardDownloadLink>
          </div>
        </li>
        <li>{t('Open the new app and keep it handy — the next steps need its credentials.')}</li>
      </WizardStepList>
      <p className="text-[11.5px] leading-relaxed text-tertiary">
        {t(
          'A custom app belongs to your own organization and needs no marketplace review — only your workspace members can use it.',
        )}
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
          {rich(t('In the left sidebar, open {page} ({site} site).'), {
            page: hl(t('Basic Info → Credentials & Basic Info')),
            site: SITE[domain],
          })}
        </li>
        <li>
          {t('Copy the App ID and App Secret from the Credentials card into the fields below.')}
        </li>
      </WizardStepList>
      <Field label={t('App ID')}>
        <Input value={appId} onChange={onAppId} placeholder="cli_xxxxxxxxxxxxxxxx" mono />
        {appId.trim().length > 0 && !appIdValid && (
          <p className="mt-1 text-[11px] text-error">{t('App ID should start with cli_.')}</p>
        )}
      </Field>
      <Field label={t('App Secret')}>
        <Input value={appSecret} onChange={onAppSecret} placeholder={t('App Secret')} mono secret />
      </Field>
    </div>
  )
}

export function PermissionsStep({ domain, appId }: { domain: LarkDomain; appId: string }) {
  return (
    <div className="space-y-3">
      <WizardConsoleLink href={larkAppPageUrl(domain, appId, 'auth')}>
        {t('Open your app’s Permissions & Scopes page')}
      </WizardConsoleLink>
      <WizardStepList>
        <li>
          {rich(t('Open {scopes}, then {import}.'), {
            scopes: hl(t('Permissions & Scopes')),
            import: hl(t('Batch import/export scopes → Import')),
          })}
        </li>
        <li>{t('Paste this JSON, then click Next, Review New Scopes and apply:')}</li>
      </WizardStepList>
      <WizardCopyableBlock value={SCOPES_IMPORT_JSON} />
      <p className="text-[11.5px] leading-relaxed text-tertiary">
        {t(
          'These let Nuphos reply as the bot, list the groups it’s in, and read a sender’s display name. Members link their own account by DMing the bot a pairing code.',
        )}
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
          {t('Open your app’s Events & Callbacks page')}
        </WizardConsoleLink>
        <WizardStepList inline>
          <li>{rich(t('Open the {tab} tab.'), { tab: hl(t('Encryption Strategy')) })}</li>
          <li>
            {rich(
              t(
                'Click the reset icon next to {field} to generate one, then paste it below. You’ll set the request URL and subscribe to events after connecting.',
              ),
              { field: hl(t('Encrypt Key')) },
            )}
          </li>
        </WizardStepList>
      </div>
      <Field label={t('Encrypt Key')}>
        <Input
          value={encryptKey}
          onChange={onEncryptKey}
          placeholder={t('Encrypt Key')}
          mono
          secret
        />
      </Field>
      <p className="text-[11.5px] leading-relaxed text-tertiary">
        {t(
          'The Encrypt Key is required — Nuphos uses it to verify and decrypt inbound events, and fails closed without it.',
        )}
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
          alt={t(
            "Event Configuration tab: set Subscription mode to 'Send notifications to developer's server', then paste the Request URL",
          )}
        />
      }
    >
      <div className="space-y-3">
        <WizardConsoleLink href={larkAppPageUrl(domain, appId, 'event')}>
          {t('Open your app’s Events & Callbacks page')}
        </WizardConsoleLink>
        <WizardStepList>
          <li>
            {rich(
              t('On the {tab} tab, set {mode} to {value} (not the default persistent connection).'),
              {
                tab: hl(t('Event Configuration')),
                mode: hl(t('Subscription mode')),
                value: hl(t('Send notifications to developer’s server')),
              },
            )}
          </li>
          <li>
            {rich(t('Paste this into {field} and save:'), { field: hl(t('Request URL')) })}
            <div className="mt-2">
              <WebhookRow url={webhookUrl} />
            </div>
          </li>
          <li>
            {rich(
              t('Then subscribe to all {count} of these events: {events}.', {
                count: LARK_SUBSCRIBE_EVENTS.length,
              }),
              {
                events: LARK_SUBSCRIBE_EVENTS.map((ev, i) => (
                  <span key={ev}>
                    {i > 0 && ', '}
                    <WizardCopyableValue value={ev} />
                  </span>
                )),
              },
            )}
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
          alt={t(
            'Create Version button in the top banner of the Lark Developer console (Version Management & Release)',
          )}
          objectPosition="right top"
        />
      }
    >
      <WizardStepList>
        <li>
          <span className="text-main">{t('Create a version to publish it.')}</span>{' '}
          {rich(
            t(
              'Everything you configured — scopes and events — stays pending until the app is published. Click {create} in the banner at the top of the app (or {manage} in the sidebar), submit it for release, and wait until it goes live. The bot won’t respond until the version is published.',
            ),
            { create: hl(t('Create Version')), manage: hl(t('Version Management & Release')) },
          )}
        </li>
        <li>
          {rich(
            t(
              'Add the bot to a Feishu / Lark group — it links automatically and shows up under Groups here. Then {mention} in that group, or DM the bot directly, and it replies.',
            ),
            { mention: hl(t('@mention Nuphos')) },
          )}
        </li>
      </WizardStepList>
    </WizardStep>
  )
}
