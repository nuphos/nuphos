import { ConsoleLink, Field } from './shared'

import type { BindState } from './use-bind-state'

export function NotionForm({ st }: { st: BindState }) {
  const { notionLabel, setNotionLabel, notionToken, setNotionToken } = st

  return (
    <>
      <div className="mb-1 rounded-md border border-zGray-800 bg-zGray-850/50 px-3 py-2.5">
        <div className="text-[12px] font-medium text-main mb-1.5">
          How to get your Notion integration token
        </div>
        <ol className="text-[12px] text-secondary leading-relaxed space-y-1 list-decimal list-inside marker:text-tertiary">
          <li>
            Open <span className="text-main">notion.so/my-integrations</span> and click{' '}
            <span className="text-main">New integration</span>.
          </li>
          <li>
            Pick this workspace, give it a name, and create it as an{' '}
            <span className="text-main">Internal</span> integration.
          </li>
          <li>
            Copy the <span className="text-main">Internal Integration Secret</span> (starts with{' '}
            <span className="font-mono">ntn_</span>).
          </li>
          <li>
            In each Notion page or database you want the agent to reach, open{' '}
            <span className="text-main">••• → Connections</span> and add this integration — Notion
            only exposes pages that have been shared with it.
          </li>
        </ol>
        <div className="mt-2.5">
          <ConsoleLink href="https://www.notion.so/my-integrations">
            Notion integrations
          </ConsoleLink>
        </div>
      </div>
      <Field label="Label" hint="A friendly name to identify this Notion workspace.">
        <input
          type="text"
          value={notionLabel}
          onChange={(e) => setNotionLabel(e.target.value)}
          placeholder="Acme Notion"
          className="w-full h-9 px-2.5 rounded-md bg-zGray-850 border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label="Integration Token"
        hint="The Internal Integration Secret from notion.so/my-integrations. Encrypted before storage."
      >
        <input
          type="password"
          value={notionToken}
          onChange={(e) => setNotionToken(e.target.value)}
          placeholder="ntn_…"
          className="w-full h-9 px-2.5 rounded-md bg-zGray-850 border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
    </>
  )
}

export function UpstashForm({ st }: { st: BindState }) {
  const {
    upstashLabel,
    setUpstashLabel,
    upstashEmail,
    setUpstashEmail,
    upstashApiKey,
    setUpstashApiKey,
  } = st

  return (
    <>
      <div className="mb-1 rounded-md border border-zGray-800 bg-zGray-850/50 px-3 py-2.5">
        <div className="text-[12px] font-medium text-main mb-1.5">
          How to get your Upstash Management API key
        </div>
        <ol className="text-[12px] text-secondary leading-relaxed space-y-1 list-decimal list-inside marker:text-tertiary">
          <li>
            Open <span className="text-main">console.upstash.com</span> and go to{' '}
            <span className="text-main">Account → Management API</span>.
          </li>
          <li>
            Click <span className="text-main">Create API Key</span> and give it a name.
          </li>
          <li>
            Copy the key immediately — Upstash only shows it once and cannot retrieve it later.
          </li>
          <li>
            Use the email you sign in to Upstash with; the API authenticates as{' '}
            <span className="font-mono">email:apiKey</span>.
          </li>
        </ol>
        <div className="mt-2.5">
          <ConsoleLink href="https://console.upstash.com/account/api">
            Upstash Management API
          </ConsoleLink>
        </div>
      </div>
      <Field label="Label" hint="A friendly name to identify this Upstash account.">
        <input
          type="text"
          value={upstashLabel}
          onChange={(e) => setUpstashLabel(e.target.value)}
          placeholder="Acme Upstash"
          className="w-full h-9 px-2.5 rounded-md bg-zGray-850 border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field label="Account Email" hint="The email of the Upstash account the key belongs to.">
        <input
          type="email"
          value={upstashEmail}
          onChange={(e) => setUpstashEmail(e.target.value)}
          placeholder="ops@acme.com"
          className="w-full h-9 px-2.5 rounded-md bg-zGray-850 border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label="Management API Key"
        hint="From console.upstash.com → Account → Management API. Encrypted before storage."
      >
        <input
          type="password"
          value={upstashApiKey}
          onChange={(e) => setUpstashApiKey(e.target.value)}
          placeholder="Upstash API key"
          className="w-full h-9 px-2.5 rounded-md bg-zGray-850 border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
    </>
  )
}

export function ResendForm({ st }: { st: BindState }) {
  const { resendLabel, setResendLabel, resendApiKey, setResendApiKey } = st

  return (
    <>
      <div className="mb-1 rounded-md border border-zGray-800 bg-zGray-850/50 px-3 py-2.5">
        <div className="text-[12px] font-medium text-main mb-1.5">
          How to get your Resend API key
        </div>
        <ol className="text-[12px] text-secondary leading-relaxed space-y-1 list-decimal list-inside marker:text-tertiary">
          <li>
            Open <span className="text-main">resend.com/api-keys</span> and click{' '}
            <span className="text-main">Create API Key</span>.
          </li>
          <li>
            Choose a permission. <span className="text-main">Sending access</span> lets the agent
            send mail and nothing else — prefer it unless the agent needs to manage domains or
            audiences.
          </li>
          <li>
            Copy the key (starts with <span className="font-mono">re_</span>) — Resend shows it only
            once.
          </li>
          <li>
            The agent can only send from a <span className="text-main">verified domain</span>, set
            up under <span className="text-main">Domains</span>.
          </li>
        </ol>
        <div className="mt-2.5">
          <ConsoleLink href="https://resend.com/api-keys">Resend API keys</ConsoleLink>
        </div>
      </div>
      <Field label="Label" hint="A friendly name to identify this Resend account.">
        <input
          type="text"
          value={resendLabel}
          onChange={(e) => setResendLabel(e.target.value)}
          placeholder="Acme Resend"
          className="w-full h-9 px-2.5 rounded-md bg-zGray-850 border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label="API Key"
        hint="From resend.com/api-keys. Encrypted before storage. Sending is disabled in new conversations until you enable this account for them."
      >
        <input
          type="password"
          value={resendApiKey}
          onChange={(e) => setResendApiKey(e.target.value)}
          placeholder="re_…"
          className="w-full h-9 px-2.5 rounded-md bg-zGray-850 border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
    </>
  )
}

export function ZeaburForm({ st }: { st: BindState }) {
  const { zeaburToken, setZeaburToken } = st

  return (
    <Field
      label="API Token"
      hint="Nuphos will discover your Zeabur user and teams from this API key."
    >
      <input
        type="password"
        value={zeaburToken}
        onChange={(e) => setZeaburToken(e.target.value)}
        placeholder="Zeabur API token"
        className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
      />
    </Field>
  )
}
