import { t } from '../../i18n'

import { ConsoleLink, Field, Fill } from './shared'

import type { BindState } from './use-bind-state'

export function NotionForm({ st }: { st: BindState }) {
  const { notionLabel, setNotionLabel, notionToken, setNotionToken } = st

  return (
    <>
      <div className="mb-1 rounded-md border border-zGray-800 bg-zGray-850/50 px-3 py-2.5">
        <div className="text-[12px] font-medium text-main mb-1.5">
          {t('How to get your Notion integration token')}
        </div>
        <ol className="text-[12px] text-secondary leading-relaxed space-y-1 list-decimal list-inside marker:text-tertiary">
          <li>
            <Fill
              text={t('Open {site} and click {button}.')}
              site={<span className="text-main">notion.so/my-integrations</span>}
              button={<span className="text-main">New integration</span>}
            />
          </li>
          <li>
            <Fill
              text={t(
                'Pick this workspace, give it a name, and create it as an {type} integration.',
              )}
              type={<span className="text-main">Internal</span>}
            />
          </li>
          <li>
            <Fill
              text={t('Copy the {secret} (starts with {prefix}).')}
              secret={<span className="text-main">Internal Integration Secret</span>}
              prefix={<span className="font-mono">ntn_</span>}
            />
          </li>
          <li>
            <Fill
              text={t(
                'In each Notion page or database you want the agent to reach, open {menu} and add this integration — Notion only exposes pages that have been shared with it.',
              )}
              menu={<span className="text-main">••• → Connections</span>}
            />
          </li>
        </ol>
        <div className="mt-2.5">
          <ConsoleLink href="https://www.notion.so/my-integrations">
            {t('Notion integrations')}
          </ConsoleLink>
        </div>
      </div>
      <Field label={t('Label')} hint={t('A friendly name to identify this Notion workspace.')}>
        <input
          type="text"
          value={notionLabel}
          onChange={(e) => setNotionLabel(e.target.value)}
          placeholder="Acme Notion"
          className="w-full h-9 px-2.5 rounded-md bg-zGray-850 border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label={t('Integration Token')}
        hint={t(
          'The Internal Integration Secret from notion.so/my-integrations. Encrypted before storage.',
        )}
      >
        <input
          type="password"
          value={notionToken}
          onChange={(e) => setNotionToken(e.target.value)}
          placeholder={t('ntn_…')}
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
          {t('How to get your Upstash Management API key')}
        </div>
        <ol className="text-[12px] text-secondary leading-relaxed space-y-1 list-decimal list-inside marker:text-tertiary">
          <li>
            <Fill
              text={t('Open {site} and go to {page}.')}
              site={<span className="text-main">console.upstash.com</span>}
              page={<span className="text-main">Account → Management API</span>}
            />
          </li>
          <li>
            <Fill
              text={t('Click {button} and give it a name.')}
              button={<span className="text-main">Create API Key</span>}
            />
          </li>
          <li>
            {t(
              'Copy the key immediately — Upstash only shows it once and cannot retrieve it later.',
            )}
          </li>
          <li>
            <Fill
              text={t(
                'Use the email you sign in to Upstash with; the API authenticates as {auth}.',
              )}
              auth={<span className="font-mono">email:apiKey</span>}
            />
          </li>
        </ol>
        <div className="mt-2.5">
          <ConsoleLink href="https://console.upstash.com/account/api">
            Upstash Management API
          </ConsoleLink>
        </div>
      </div>
      <Field label={t('Label')} hint={t('A friendly name to identify this Upstash account.')}>
        <input
          type="text"
          value={upstashLabel}
          onChange={(e) => setUpstashLabel(e.target.value)}
          placeholder="Acme Upstash"
          className="w-full h-9 px-2.5 rounded-md bg-zGray-850 border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label={t('Account Email')}
        hint={t('The email of the Upstash account the key belongs to.')}
      >
        <input
          type="email"
          value={upstashEmail}
          onChange={(e) => setUpstashEmail(e.target.value)}
          placeholder={t('ops@acme.com')}
          className="w-full h-9 px-2.5 rounded-md bg-zGray-850 border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label={t('Management API Key')}
        hint={t('From console.upstash.com → Account → Management API. Encrypted before storage.')}
      >
        <input
          type="password"
          value={upstashApiKey}
          onChange={(e) => setUpstashApiKey(e.target.value)}
          placeholder={t('Upstash API key')}
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
          {t('How to get your Resend API key')}
        </div>
        <ol className="text-[12px] text-secondary leading-relaxed space-y-1 list-decimal list-inside marker:text-tertiary">
          <li>
            <Fill
              text={t('Open {site} and click {button}.')}
              site={<span className="text-main">resend.com/api-keys</span>}
              button={<span className="text-main">Create API Key</span>}
            />
          </li>
          <li>
            <Fill
              text={t(
                'Choose a permission. {access} lets the agent send mail and nothing else — prefer it unless the agent needs to manage domains or audiences.',
              )}
              access={<span className="text-main">Sending access</span>}
            />
          </li>
          <li>
            <Fill
              text={t('Copy the key (starts with {prefix}) — Resend shows it only once.')}
              prefix={<span className="font-mono">re_</span>}
            />
          </li>
          <li>
            <Fill
              text={t('The agent can only send from a {domain}, set up under {page}.')}
              domain={<span className="text-main">{t('verified domain')}</span>}
              page={<span className="text-main">Domains</span>}
            />
          </li>
        </ol>
        <div className="mt-2.5">
          <ConsoleLink href="https://resend.com/api-keys">{t('Resend API keys')}</ConsoleLink>
        </div>
      </div>
      <Field label={t('Label')} hint={t('A friendly name to identify this Resend account.')}>
        <input
          type="text"
          value={resendLabel}
          onChange={(e) => setResendLabel(e.target.value)}
          placeholder="Acme Resend"
          className="w-full h-9 px-2.5 rounded-md bg-zGray-850 border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label={t('API Key')}
        hint={t(
          'From resend.com/api-keys. Encrypted before storage. Sending is disabled in new agents until you enable this account for them.',
        )}
      >
        <input
          type="password"
          value={resendApiKey}
          onChange={(e) => setResendApiKey(e.target.value)}
          placeholder={t('re_…')}
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
      label={t('API Token')}
      hint={t('Nuphos will discover your Zeabur user and teams from this API key.')}
    >
      <input
        type="password"
        value={zeaburToken}
        onChange={(e) => setZeaburToken(e.target.value)}
        placeholder={t('Zeabur API token')}
        className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
      />
    </Field>
  )
}
