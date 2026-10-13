import { faShieldHalved, faSpinner } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'

import { CloudLogo } from '../../components/CloudLogo'

import { CLOUDFLARE_SCOPE_CATEGORIES } from './cloudflare-scopes'
import { cloudflareScopesFor } from './constants'

import type { BindState } from './use-bind-state'

export function CloudflareConnect({
  st,
  onConnect,
}: {
  st: BindState
  onConnect: (scopes: string[]) => void
}) {
  const { cfScopeAccess, setCfScopeAccess, cloudflareConnecting, submitting } = st

  return (
    <div className="-mt-1">
      {/* Brand hero — Cloudflare mark over a soft orange glow */}
      <div className="relative flex flex-col items-center pt-3 pb-1">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-3 h-28 w-28 rounded-full opacity-70 blur-2xl"
          style={{
            background: 'radial-gradient(closest-side, rgba(243,128,32,0.42), transparent)',
          }}
        />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-[18px] bg-white shadow-[0_10px_28px_-8px_rgba(243,128,32,0.6)] ring-1 ring-[#f38020]/25">
          <CloudLogo provider="cloudflare" size={34} />
        </div>
      </div>

      <p className="mt-3 text-center text-[12.5px] leading-relaxed text-secondary">
        Choose what Nuphos can manage, then authorize in your browser.
        <br />
        No API token to create, scope, or paste.
      </p>

      {/* Access selector — picked scopes are sent to the authorize request */}
      <div className="mt-4 max-h-[340px] space-y-1.5 overflow-y-auto scrollbar-thin">
        {CLOUDFLARE_SCOPE_CATEGORIES.map((r) => (
          <div
            key={r.key}
            className="flex items-center gap-2.5 rounded-lg border border-zGray-800 bg-zGray-850/40 px-3 py-2"
          >
            <FontAwesomeIcon icon={r.icon} className="h-3.5 w-3.5 text-[#f38020]" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] leading-none text-main">{r.label}</div>
              <div className="mt-1 text-[10.5px] text-tertiary">{r.hint}</div>
            </div>
            <div className="flex items-center gap-0.5 rounded-md bg-zGray-900 p-0.5">
              {(['off', 'read', 'write'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setCfScopeAccess((s) => ({ ...s, [r.key]: level }))}
                  className={clsx(
                    'h-6 rounded px-2 text-[11px] font-medium transition-colors',
                    cfScopeAccess[r.key] === level
                      ? 'bg-[#f38020] text-white'
                      : 'text-tertiary hover:text-secondary',
                  )}
                >
                  {level === 'off' ? 'Off' : level === 'read' ? 'Read' : 'Write'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Primary CTA */}
      <button
        type="button"
        onClick={() => onConnect(cloudflareScopesFor(cfScopeAccess))}
        disabled={cloudflareConnecting || submitting}
        className={clsx(
          'group relative mt-5 flex h-11 w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl text-[13px] font-semibold text-white transition-all',
          'shadow-[0_10px_24px_-8px_rgba(243,128,32,0.7)] disabled:cursor-not-allowed disabled:opacity-70',
          'bg-gradient-to-b from-[#f9943a] to-[#f06b15] hover:from-[#fa9f4c] hover:to-[#f3781f] active:scale-[0.99]',
        )}
      >
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-white/30" />
        {cloudflareConnecting ? (
          <>
            <FontAwesomeIcon icon={faSpinner} className="h-4 w-4 animate-spin" />
            Waiting for browser authorization…
          </>
        ) : (
          <>
            <CloudLogo provider="cloudflare" size={18} />
            Connect with Cloudflare
          </>
        )}
      </button>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-tertiary">
        <FontAwesomeIcon icon={faShieldHalved} className="h-3 w-3" />
        Tokens are encrypted and refreshed automatically · revoke anytime in Cloudflare.
      </p>
    </div>
  )
}
