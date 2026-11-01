import { AppSelect } from '../../components/ui/select'
import { t } from '../../i18n'

import { ConsoleLink, Field, Fill } from './shared'

import type { BindState } from './use-bind-state'

const SECUREFRAME_REGIONS = [
  { value: 'us', label: 'US (api.secureframe.com)' },
  { value: 'uk', label: 'UK (api-uk.secureframe.com)' },
]
const mono = (text: string) => <span className="font-mono">{text}</span>
const main = (text: string) => <span className="text-main">{text}</span>
const Step = (props: Parameters<typeof Fill>[0]) => (
  <li>
    <Fill {...props} />
  </li>
)

export function TailscaleForm({ st, teamId }: { st: BindState; teamId: string }) {
  const {
    tailscaleLabel,
    setTailscaleLabel,
    tailscaleFederated,
    setTailscaleFederated,
    tailscaleClientId,
    setTailscaleClientId,
    tailscaleClientSecret,
    setTailscaleClientSecret,
  } = st

  return (
    <>
      <Field
        label={t('Label')}
        hint={t('A friendly name to identify this Tailscale tailnet credential.')}
      >
        <input
          type="text"
          value={tailscaleLabel}
          onChange={(e) => setTailscaleLabel(e.target.value)}
          placeholder="Production tailnet"
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label={t('How Nuphos authenticates')}
        hint={
          tailscaleFederated
            ? t(
                'Nuphos proves its identity with a signed token each time, so no credential of yours is ever stored here.',
              )
            : t(
                'The secret is encrypted before storage and exchanged for short-lived access tokens.',
              )
        }
      >
        <div className="flex gap-2">
          {(
            [
              ['federated', 'OpenID Connect', true],
              ['oauth', t('OAuth client secret'), false],
            ] as const
          ).map(([key, text, federated]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTailscaleFederated(federated)}
              className={`flex-1 h-9 rounded-md border text-[12.5px] font-medium ${
                tailscaleFederated === federated
                  ? 'border-zViolet-500 bg-zViolet-500/10 text-main'
                  : 'border-zGray-800 bg-surface text-secondary hover:text-main'
              }`}
            >
              {text}
            </button>
          ))}
        </div>
      </Field>
      {tailscaleFederated && (
        <div className="mb-1 rounded-md border border-zGray-800 bg-zGray-850/50 px-3 py-2.5">
          <div className="text-[12px] font-medium text-main mb-1.5">
            {t('Create the trust credential in Tailscale first')}
          </div>
          <ol className="text-[12px] text-secondary leading-relaxed space-y-1 list-decimal list-inside marker:text-tertiary">
            <li>{t('Admin Console → Settings → Trust credentials → New credential.')}</li>
            <Step text={t('Choose {value}.')} value={mono('OpenID Connect')} />
            <Step text={t('Issuer URL: {value}')} value={mono('https://nuphos.ai')} />
            <Step text={t('Subject: {value}')} value={mono(`nuphos:team:${teamId}`)} />
            <Step
              text={t('Scopes: {scope} (add {extra} to list devices).')}
              scope={mono('auth_keys')}
              extra={mono('devices:core')}
            />
            <li>{t('Leave Audience empty, then paste the client ID below.')}</li>
          </ol>
        </div>
      )}
      <Field
        label={t('Client ID')}
        hint={t('Tailscale Admin Console → Settings → Trust credentials.')}
      >
        <input
          type="text"
          value={tailscaleClientId}
          onChange={(e) => setTailscaleClientId(e.target.value)}
          placeholder={t('Tailscale OAuth client ID')}
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      {!tailscaleFederated && (
        <Field
          label={t('OAuth Client Secret')}
          hint={t('Stored encrypted. Prefer OpenID Connect above, which stores nothing.')}
        >
          <input
            type="password"
            value={tailscaleClientSecret}
            onChange={(e) => setTailscaleClientSecret(e.target.value)}
            placeholder={t('Tailscale OAuth client secret')}
            className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
          />
        </Field>
      )}
    </>
  )
}

export function VantaForm({ st }: { st: BindState }) {
  const {
    vantaLabel,
    setVantaLabel,
    vantaClientId,
    setVantaClientId,
    vantaClientSecret,
    setVantaClientSecret,
  } = st

  return (
    <>
      <div className="mb-1 rounded-md border border-zGray-800 bg-zGray-850/50 px-3 py-2.5">
        <div className="text-[12px] font-medium text-main mb-1.5">
          {t('How to get your Vanta Client ID & Secret')}
        </div>
        <ol className="text-[12px] text-secondary leading-relaxed space-y-1 list-decimal list-inside marker:text-tertiary">
          <li>{t('Sign in to {name} as an admin.', { name: 'Vanta' })}</li>
          <Step text={t('Open {page}.')} page={main('Settings → Developer console')} />
          <Step
            text={t('Create an app of type {type} (OAuth client credentials).')}
            type={main('“Manage Vanta”')}
          />
          <li>{t('Grant it read access to tests / vulnerabilities.')}</li>
          <Step
            text={t('Copy the {id} ({idPrefix}) and generate a {secret} ({secretPrefix}).')}
            id={main('Client ID')}
            idPrefix={mono('vci_…')}
            secret={main('Client Secret')}
            secretPrefix={mono('vcs_…')}
          />
        </ol>
        <div className="mt-2.5">
          <ConsoleLink href="https://app.vanta.com/settings/developer-console">
            {t('Open {page}', { page: 'Vanta Developer console' })}
          </ConsoleLink>
        </div>
      </div>
      <Field label={t('Label')} hint={t('A friendly name to identify this Vanta organization.')}>
        <input
          type="text"
          value={vantaLabel}
          onChange={(e) => setVantaLabel(e.target.value)}
          placeholder="Acme Vanta"
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label={t('Client ID')}
        hint={t(
          'In Vanta: Settings → Developer Console → Create a “Manage Vanta” app. The client ID starts with vci_.',
        )}
      >
        <input
          type="text"
          value={vantaClientId}
          onChange={(e) => setVantaClientId(e.target.value)}
          placeholder="vci_…"
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label={t('Client Secret')}
        hint={t(
          'Generate a client secret on the same app (starts with vcs_). It is encrypted before storage; access tokens are minted on demand.',
        )}
      >
        <input
          type="password"
          value={vantaClientSecret}
          onChange={(e) => setVantaClientSecret(e.target.value)}
          placeholder="vcs_…"
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
    </>
  )
}

export function SecureframeForm({ st }: { st: BindState }) {
  const {
    secureframeLabel,
    setSecureframeLabel,
    secureframeRegion,
    setSecureframeRegion,
    secureframeApiKey,
    setSecureframeApiKey,
    secureframeApiSecret,
    setSecureframeApiSecret,
  } = st

  return (
    <>
      <div className="mb-1 rounded-md border border-zGray-800 bg-zGray-850/50 px-3 py-2.5">
        <div className="text-[12px] font-medium text-main mb-1.5">
          {t('How to get your Secureframe API Key & Secret')}
        </div>
        <ol className="text-[12px] text-secondary leading-relaxed space-y-1 list-decimal list-inside marker:text-tertiary">
          <li>{t('Sign in to {name} as an admin.', { name: 'Secureframe' })}</li>
          <Step text={t('Open {page}.')} page={main('Company settings → API keys')} />
          <Step text={t('Click {button}.')} button={main('Create API key')} />
          <Step
            text={t(
              'Copy the {apiKey} (the key id) and the {secret} — the secret is shown only once.',
            )}
            apiKey={main('API key')}
            secret={main('API secret')}
          />
          <Step
            text={t('Pick the matching {region} below (UK accounts use {host}).')}
            region={main(t('region'))}
            host={mono('api-uk.secureframe.com')}
          />
        </ol>
        <div className="mt-2.5">
          <ConsoleLink href="https://developer.secureframe.com">
            {t('{name} API docs', { name: 'Secureframe' })}
          </ConsoleLink>
        </div>
      </div>
      <Field
        label={t('Label')}
        hint={t('A friendly name to identify this Secureframe organization.')}
      >
        <input
          type="text"
          value={secureframeLabel}
          onChange={(e) => setSecureframeLabel(e.target.value)}
          placeholder="Acme Secureframe"
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label={t('Region')}
        hint={t('Your Secureframe data region. UK accounts use api-uk.secureframe.com.')}
      >
        <AppSelect
          value={secureframeRegion}
          onValueChange={(value) => setSecureframeRegion(value as 'us' | 'uk')}
          options={SECUREFRAME_REGIONS}
          ariaLabel={t('Region')}
        />
      </Field>
      <Field
        label={t('API Key')}
        hint={t(
          'In Secureframe: Company Settings → API keys → Create API Key. This is the key id.',
        )}
      >
        <input
          type="text"
          value={secureframeApiKey}
          onChange={(e) => setSecureframeApiKey(e.target.value)}
          placeholder={t('Secureframe API key')}
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label={t('API Secret')}
        hint={t('The key secret shown once when you create the key. Encrypted before storage.')}
      >
        <input
          type="password"
          value={secureframeApiSecret}
          onChange={(e) => setSecureframeApiSecret(e.target.value)}
          placeholder={t('Secureframe API secret')}
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
    </>
  )
}
