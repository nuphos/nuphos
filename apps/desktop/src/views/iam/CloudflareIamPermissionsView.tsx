import clsx from 'clsx'
import { ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { SectionHeader } from '../../components/SectionHeader'
import { Button } from '../../components/ui/button'
import { useReportLoading } from '../../components/useReportLoading'
import { useSilentTick } from '../../hooks/useSilentRefresh'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { t } from '../../i18n'
import { BindAccountDialog } from '../BindAccountDialog'
import { useResetOnKey } from '../useResetOnKey'

import { formatExpiry } from './common'
import { EmptyHint, ProviderSummaryCard, Warnings } from './permissionCards'
import { SelfManagementCard } from './SelfManagementCard'

import type { CommonProps } from './common'
import type { CloudflareIamInfo } from '../../types'

export function CloudflareIamPermissionsView({
  teamId,
  accountId,
  refreshKey,
  onLoading,
}: CommonProps & { accountId: string }) {
  const [data, setData] = useState<CloudflareIamInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reauthorizing, setReauthorizing] = useState(false)
  const reqRef = useRef(0)

  useReportLoading(loading, onLoading)

  useResetOnKey(`${teamId}|${accountId}|${String(refreshKey)}`, () => {
    setLoading(true)
    setError(null)
  })

  useEffect(() => {
    const req = ++reqRef.current

    api
      .atlasGetCloudflareIamPermissions(teamId, accountId)
      .then((res) => {
        if (req !== reqRef.current) return
        setData(res)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (req !== reqRef.current) return
        setError(String(e instanceof Error ? e.message : e))
        setLoading(false)
      })
  }, [teamId, accountId, refreshKey])

  const { pollTick } = useWorkspaceTab()
  const silentReload = useCallback(() => {
    // Snapshot the current request id instead of incrementing it: a poll
    // must NOT invalidate an in-flight foreground load (which is what
    // tracks `loading`). If a foreground load lands between this snapshot
    // and the response, `req !== reqRef.current` and we drop the stale
    // background result.
    const req = reqRef.current

    api
      .atlasGetCloudflareIamPermissions(teamId, accountId)
      .then((res) => {
        if (req !== reqRef.current) return
        setData(res)
        setError(null)
      })
      .catch((e: unknown) => {
        if (req !== reqRef.current) return
        setError(String(e instanceof Error ? e.message : e))
      })
  }, [teamId, accountId])

  useSilentTick(silentReload, pollTick)

  // The current bind flow is Cloudflare OAuth — render scopes + connection
  // health. The token-policy layout below only survives for legacy API-token
  // bindings that predate it.
  if (!data || data.authType === 'oauth') {
    const oauth = data?.authType === 'oauth' ? data : null

    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {error && (
            <div className="m-4 p-3 rounded-md border border-error/40 bg-error/10 text-[12.5px] text-error">
              {error}
            </div>
          )}
          {loading && !oauth && (
            <div className="px-6 py-5 text-[12.5px] text-tertiary">{t('Checking connection…')}</div>
          )}
          {oauth && (
            <>
              <ProviderSummaryCard
                provider="cloudflare"
                title={oauth.accountName ?? oauth.accountId}
                subtitle={oauth.accountId}
                rows={[
                  { label: t('Account ID'), value: oauth.accountId, mono: true },
                  { label: t('Auth'), value: 'Cloudflare OAuth' },
                  {
                    label: t('Connection'),
                    value:
                      oauth.connectionStatus === 'ok' ? t('Connected') : t('Broken — reconnect'),
                    status: oauth.connectionStatus === 'ok' ? 'success' : 'error',
                  },
                  {
                    label: t('Access token'),
                    value: !oauth.hasRefreshToken
                      ? t('No refresh token — expires without renewal')
                      : oauth.accessTokenExpiresAt
                        ? t('Auto-refreshed · current expires {time}', {
                            time: new Date(oauth.accessTokenExpiresAt).toLocaleString(),
                          })
                        : t('Auto-refreshed'),
                    status: oauth.hasRefreshToken ? undefined : 'error',
                  },
                  { label: t('OAuth client'), value: oauth.clientId, mono: true },
                ]}
              />
              <Warnings warnings={oauth.warnings} />
              <section className="px-6 py-4">
                <SectionHeader
                  icon={<ShieldCheck className="w-4 h-4 text-zViolet-accent" strokeWidth={1.8} />}
                  title={t('Granted scopes')}
                  hint={
                    oauth.scopes.length === 1
                      ? t('{n} scope on this OAuth grant', { n: oauth.scopes.length })
                      : t('{n} scopes on this OAuth grant', { n: oauth.scopes.length })
                  }
                />
                {oauth.scopes.length === 0 ? (
                  <EmptyHint
                    message={t(
                      'The OAuth grant reports no scopes — reconnect the account to re-authorize.',
                    )}
                  />
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {oauth.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="px-2 py-1 rounded-md border border-zGray-800 bg-zGray-950 font-mono text-[11.5px] text-secondary"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1 text-[11.5px] text-tertiary">
                    {t(
                      'Scopes are fixed by the Cloudflare OAuth grant. Re-authorize this account to change them.',
                    )}
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setReauthorizing(true)}>
                    {t('Update scopes')}
                  </Button>
                </div>
              </section>
              <BindAccountDialog
                open={reauthorizing}
                teamId={teamId}
                initialProvider="cloudflare"
                onClose={() => setReauthorizing(false)}
                onBound={() => {
                  setReauthorizing(false)
                  silentReload()
                }}
              />
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {error && (
          <div className="m-4 p-3 rounded-md border border-error/40 bg-error/10 text-[12.5px] text-error">
            {error}
          </div>
        )}
        <ProviderSummaryCard
          provider="cloudflare"
          title={data.tokenName ?? data.tokenId ?? t('API token')}
          subtitle={data.accountId}
          rows={[
            { label: t('Account ID'), value: data.accountId, mono: true },
            {
              label: t('Token status'),
              value: data.tokenStatus ?? '—',
              status:
                data.tokenStatus === 'active' ? 'success' : data.tokenStatus ? 'error' : undefined,
            },
            { label: t('Expires'), value: formatExpiry(data.expiresOn) },
          ]}
        />
        <SelfManagementCard capabilities={data.selfCapabilities} />
        <Warnings warnings={data.warnings} />
        <section className="px-6 py-4">
          <SectionHeader
            icon={<ShieldCheck className="w-4 h-4 text-zViolet-accent" strokeWidth={1.8} />}
            title={t('Token policies')}
            hint={
              data.policies === null
                ? t("Couldn't read token policies (token lacks User Details: Read)")
                : data.policies.length === 1
                  ? t('{n} policy on this token', { n: data.policies.length })
                  : t('{n} policies on this token', { n: data.policies.length })
            }
          />
          {data.policies === null ? (
            <EmptyHint
              message={
                data.tokenStatus === 'active'
                  ? t(
                      'This token is account-scoped, so Cloudflare won\'t return its own policy list (only user-scoped tokens with "User Details: Read" can self-introspect). The token works for the granted account/zone APIs — view it in the Cloudflare dashboard at My Profile → API Tokens to see the exact permissions.',
                    )
                  : t(
                      'Cloudflare API tokens can only list their own policies if they include the "User Details: Read" permission. Add it to your Nuphos token to see what was granted.',
                    )
              }
            />
          ) : data.policies.length === 0 ? (
            <EmptyHint
              message={t('This token has no policies attached, so every API call will be denied.')}
            />
          ) : (
            <div className="space-y-2">
              {data.policies.map((p, idx) => (
                <div
                  key={idx}
                  className={clsx(
                    'rounded-md border bg-zGray-950 px-3 py-2',
                    p.effect === 'allow' ? 'border-success/30' : 'border-error/30',
                  )}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className={clsx(
                        'text-[10.5px] uppercase tracking-wider font-semibold',
                        p.effect === 'allow' ? 'text-success' : 'text-error',
                      )}
                    >
                      {p.effect}
                    </span>
                    <span className="text-[11.5px] text-tertiary">{t('on resources')}</span>
                  </div>
                  <div className="mb-2 space-y-0.5">
                    {Object.entries(p.resources).map(([k, v]) => (
                      <div key={k} className="font-mono text-[11px] text-secondary break-all">
                        {k}
                        {v === '*' ? '' : ` → ${v}`}
                      </div>
                    ))}
                  </div>
                  {p.permissionGroups.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {p.permissionGroups.map((g) => (
                        <span
                          key={g.id}
                          className="text-[10.5px] font-mono px-1.5 py-0.5 rounded bg-zGray-900 text-secondary border border-zGray-850"
                          title={g.scopes?.join(', ')}
                        >
                          {g.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
