import { ConsoleLink, Field } from './shared'

import type { BindState } from './use-bind-state'

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
      <Field label="Label" hint="A friendly name to identify this Tailscale tailnet credential.">
        <input
          type="text"
          value={tailscaleLabel}
          onChange={(e) => setTailscaleLabel(e.target.value)}
          placeholder="Production tailnet"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label="How Nuphos authenticates"
        hint={
          tailscaleFederated
            ? 'Nuphos proves its identity with a signed token each time, so no credential of yours is ever stored here.'
            : 'The secret is encrypted before storage and exchanged for short-lived access tokens.'
        }
      >
        <div className="flex gap-2">
          {(
            [
              ['federated', 'OpenID Connect', true],
              ['oauth', 'OAuth client secret', false],
            ] as const
          ).map(([key, text, federated]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTailscaleFederated(federated)}
              className={`flex-1 h-9 rounded-md border text-[12.5px] font-medium ${
                tailscaleFederated === federated
                  ? 'border-zViolet-500 bg-zViolet-500/10 text-main'
                  : 'border-zGray-800 bg-field text-secondary hover:text-main'
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
            Create the trust credential in Tailscale first
          </div>
          <ol className="text-[12px] text-secondary leading-relaxed space-y-1 list-decimal list-inside marker:text-tertiary">
            <li>Admin Console → Settings → Trust credentials → New credential.</li>
            <li>
              Choose <span className="font-mono">OpenID Connect</span>.
            </li>
            <li>
              Issuer URL: <span className="font-mono">https://nuphos.ai</span>
            </li>
            <li>
              Subject: <span className="font-mono">nuphos:team:{teamId}</span>
            </li>
            <li>
              Scopes: <span className="font-mono">auth_keys</span> (add{' '}
              <span className="font-mono">devices:core</span> to list devices).
            </li>
            <li>Leave Audience empty, then paste the client ID below.</li>
          </ol>
        </div>
      )}
      <Field label="Client ID" hint="Tailscale Admin Console → Settings → Trust credentials.">
        <input
          type="text"
          value={tailscaleClientId}
          onChange={(e) => setTailscaleClientId(e.target.value)}
          placeholder="Tailscale OAuth client ID"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      {!tailscaleFederated && (
        <Field
          label="OAuth Client Secret"
          hint="Stored encrypted. Prefer OpenID Connect above, which stores nothing."
        >
          <input
            type="password"
            value={tailscaleClientSecret}
            onChange={(e) => setTailscaleClientSecret(e.target.value)}
            placeholder="Tailscale OAuth client secret"
            className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
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
          How to get your Vanta Client ID &amp; Secret
        </div>
        <ol className="text-[12px] text-secondary leading-relaxed space-y-1 list-decimal list-inside marker:text-tertiary">
          <li>Sign in to Vanta as an admin.</li>
          <li>
            Open <span className="text-main">Settings → Developer console</span>.
          </li>
          <li>
            Create an app of type <span className="text-main">“Manage Vanta”</span> (OAuth client
            credentials).
          </li>
          <li>Grant it read access to tests / vulnerabilities.</li>
          <li>
            Copy the <span className="text-main">Client ID</span> (
            <span className="font-mono">vci_…</span>) and generate a{' '}
            <span className="text-main">Client Secret</span> (
            <span className="font-mono">vcs_…</span>).
          </li>
        </ol>
        <div className="mt-2.5">
          <ConsoleLink href="https://app.vanta.com/settings/developer-console">
            Open Vanta Developer console
          </ConsoleLink>
        </div>
      </div>
      <Field label="Label" hint="A friendly name to identify this Vanta organization.">
        <input
          type="text"
          value={vantaLabel}
          onChange={(e) => setVantaLabel(e.target.value)}
          placeholder="Acme Vanta"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label="Client ID"
        hint="In Vanta: Settings → Developer Console → Create a “Manage Vanta” app. The client ID starts with vci_."
      >
        <input
          type="text"
          value={vantaClientId}
          onChange={(e) => setVantaClientId(e.target.value)}
          placeholder="vci_…"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label="Client Secret"
        hint="Generate a client secret on the same app (starts with vcs_). It is encrypted before storage; access tokens are minted on demand."
      >
        <input
          type="password"
          value={vantaClientSecret}
          onChange={(e) => setVantaClientSecret(e.target.value)}
          placeholder="vcs_…"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
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
          How to get your Secureframe API Key &amp; Secret
        </div>
        <ol className="text-[12px] text-secondary leading-relaxed space-y-1 list-decimal list-inside marker:text-tertiary">
          <li>Sign in to Secureframe as an admin.</li>
          <li>
            Open <span className="text-main">Company settings → API keys</span>.
          </li>
          <li>
            Click <span className="text-main">Create API key</span>.
          </li>
          <li>
            Copy the <span className="text-main">API key</span> (the key id) and the{' '}
            <span className="text-main">API secret</span> — the secret is shown only once.
          </li>
          <li>
            Pick the matching <span className="text-main">region</span> below (UK accounts use{' '}
            <span className="font-mono">api-uk.secureframe.com</span>).
          </li>
        </ol>
        <div className="mt-2.5">
          <ConsoleLink href="https://developer.secureframe.com">Secureframe API docs</ConsoleLink>
        </div>
      </div>
      <Field label="Label" hint="A friendly name to identify this Secureframe organization.">
        <input
          type="text"
          value={secureframeLabel}
          onChange={(e) => setSecureframeLabel(e.target.value)}
          placeholder="Acme Secureframe"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label="Region"
        hint="Your Secureframe data region. UK accounts use api-uk.secureframe.com."
      >
        <select
          value={secureframeRegion}
          onChange={(e) => setSecureframeRegion(e.target.value as 'us' | 'uk')}
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] text-main"
        >
          <option value="us">US (api.secureframe.com)</option>
          <option value="uk">UK (api-uk.secureframe.com)</option>
        </select>
      </Field>
      <Field
        label="API Key"
        hint="In Secureframe: Company Settings → API keys → Create API Key. This is the key id."
      >
        <input
          type="text"
          value={secureframeApiKey}
          onChange={(e) => setSecureframeApiKey(e.target.value)}
          placeholder="Secureframe API key"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label="API Secret"
        hint="The key secret shown once when you create the key. Encrypted before storage."
      >
        <input
          type="password"
          value={secureframeApiSecret}
          onChange={(e) => setSecureframeApiSecret(e.target.value)}
          placeholder="Secureframe API secret"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
    </>
  )
}
