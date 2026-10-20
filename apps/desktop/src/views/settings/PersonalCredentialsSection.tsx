import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { parseAtlasError } from '../../api/errors'
import { CloudLogo } from '../../components/CloudLogo'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { SkeletonReveal } from '../../components/SkeletonReveal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'

import { PERSONAL_CREDENTIALS_CHANGED, nameOf } from './personalCredentials'
import { SectionHeader } from './shared'

import type { PersonalCredential, PersonalCredentialProvider } from '../../types'

const PROVIDERS: { provider: PersonalCredentialProvider; name: string; description: string }[] = [
  {
    provider: 'github',
    name: 'GitHub',
    description:
      'Act as yourself on GitHub — commits, PRs and comments are authored by you instead of nuphos[bot]. Conversations scoped to one repository keep using nuphos[bot].',
  },
  {
    provider: 'linear',
    name: 'Linear',
    description: 'Linear issues and comments are authored by you instead of the team’s Linear app.',
  },
]

export function PersonalCredentialsSection() {
  const [credentials, setCredentials] = useState<PersonalCredential[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<PersonalCredentialProvider | null>(null)
  const [disconnecting, setDisconnecting] = useState<PersonalCredentialProvider | null>(null)

  const refresh = useCallback(() => {
    void api
      .atlasListPersonalCredentials()
      .then((list) => {
        setCredentials(list)
        setLoadFailed(false)
      })
      .catch((err: unknown) => {
        setLoadFailed(true)
        toast.apiError('Could not load Personal Credentials', err)
      })
  }, [])

  // Refetch after a claimed deep link, and on focus as a fallback.
  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener(PERSONAL_CREDENTIALS_CHANGED, refresh)

    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener(PERSONAL_CREDENTIALS_CHANGED, refresh)
    }
  }, [refresh])

  async function connect(provider: PersonalCredentialProvider) {
    setBusy(provider)
    try {
      const { authorizeUrl } = await api.atlasStartPersonalCredential(provider)

      await api.appOpenExternal(authorizeUrl)
    } catch (err) {
      if (parseAtlasError(err).code === 'personal_credential_not_configured') {
        toast.error(`Could not connect ${nameOf(provider)}`, 'Not configured on this server yet')
      } else {
        toast.apiError(`Could not connect ${nameOf(provider)}`, err)
      }
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(provider: PersonalCredentialProvider) {
    setBusy(provider)
    try {
      await api.atlasDeletePersonalCredential(provider)
      toast.success(`${nameOf(provider)} disconnected`)
    } catch (err) {
      toast.apiError(`Could not disconnect ${nameOf(provider)}`, err)
    } finally {
      setBusy(null)
      refresh()
    }
  }

  return (
    <div>
      <SectionHeader
        title="Personal Credentials"
        description="Connect your own accounts so the agent acts as you."
      />
      {!credentials && loadFailed && (
        <p className="text-[12.5px] text-tertiary">
          Couldn’t load your Personal Credentials.{' '}
          <Button type="button" size="sm" variant="secondary" onClick={refresh}>
            Retry
          </Button>
        </p>
      )}
      {(credentials || !loadFailed) && (
        <SkeletonReveal
          ready={Boolean(credentials)}
          skeleton={
            <div aria-busy="true" className="space-y-3">
              <div className="h-[72px] rounded-lg bg-zGray-800/40" />
              <div className="h-[72px] rounded-lg bg-zGray-800/40" />
            </div>
          }
        >
          <div className="space-y-3">
            {PROVIDERS.map(({ provider, name, description }) => {
              const credential = credentials?.find((c) => c.provider === provider)

              return (
                <div
                  key={provider}
                  className="flex items-center gap-4 rounded-lg border border-zGray-800/70 bg-surface px-4 py-3.5"
                >
                  <CloudLogo provider={provider} size={22} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-main">{name}</div>
                    <p className="mt-0.5 text-[12.5px] text-tertiary">{description}</p>
                    <div className="t-collapse" data-open={Boolean(credential)}>
                      <div className="t-collapse-inner">
                        {credential && (
                          <p className="mt-1.5 text-[12.5px] text-secondary">
                            Connected as{' '}
                            <span className="font-medium text-main">{credential.login}</span>
                            {credential.workspaceName && ` · ${credential.workspaceName}`}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  {credential ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy === provider}
                      onClick={() => setDisconnecting(provider)}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy === provider}
                      onClick={() => void connect(provider)}
                    >
                      Connect
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </SkeletonReveal>
      )}
      <p className="mt-4 text-[12px] text-tertiary">
        Used when you send a message, and for automated runs in sessions you own.
      </p>
      <ConfirmDialog
        open={disconnecting !== null}
        title={`Disconnect ${disconnecting ? nameOf(disconnecting) : ''}`}
        description="Your messages will use the team’s credentials again. The grant is also revoked at the provider."
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => (disconnecting ? disconnect(disconnecting) : undefined)}
        onClose={() => setDisconnecting(null)}
      />
    </div>
  )
}
