import { t } from '../../i18n'

import { ConsoleLink, Field, Fill } from './shared'

import type { BindState } from './use-bind-state'

const INPUT =
  'w-full h-9 px-2.5 rounded-md bg-surface-sunken border border-line-control focus:border-line-focus outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main'

/** The team's own instabox account: New computer can then make Boxes that instabox bills to it. */
export function InstaboxForm({ st }: { st: BindState }) {
  const { instaboxLabel, setInstaboxLabel, instaboxApiKey, setInstaboxApiKey } = st

  return (
    <>
      <div className="mb-1 rounded-md border border-line-control bg-state-selected px-3 py-2.5">
        <div className="text-[12px] font-medium text-main mb-1.5">
          {t('How to get your instabox API key')}
        </div>
        <ol className="text-[12px] text-secondary leading-relaxed space-y-1 list-decimal list-inside marker:text-tertiary">
          <li>
            <Fill
              text={t('Open the instabox dashboard and go to {page}, or run {command}.')}
              page={<span className="text-main">API keys</span>}
              command={<span className="font-mono">instabox keys create</span>}
            />
          </li>
          <li>
            <Fill
              text={t('Copy the key (starts with {prefix}).')}
              prefix={<span className="font-mono">ibk_</span>}
            />
          </li>
          <li>
            {t(
              'Computers made on this account are billed to it by instabox, not to your Nuphos plan.',
            )}
          </li>
        </ol>
        <div className="mt-2.5">
          <ConsoleLink href="https://instabox.sh">instabox</ConsoleLink>
        </div>
      </div>
      <Field label={t('Label')} hint={t('A friendly name to identify this instabox account.')}>
        <input
          type="text"
          value={instaboxLabel}
          onChange={(e) => setInstaboxLabel(e.target.value)}
          placeholder="Acme instabox"
          className={INPUT}
        />
      </Field>
      <Field label={t('API Key')} hint={t('Encrypted before storage; agents never see it.')}>
        <input
          type="password"
          value={instaboxApiKey}
          onChange={(e) => setInstaboxApiKey(e.target.value)}
          placeholder="ibk_…"
          className={INPUT}
        />
      </Field>
    </>
  )
}
