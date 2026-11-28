import { useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { useLocalRuntimeState } from '../../hooks/useLocalRuntimeState'
import { useThisComputer } from '../../hooks/useThisComputer'
import { t } from '../../i18n'
import { agentProvider } from '../../types/runtime'

import { ownCliProvider } from './agentPresentation'
import { CustomProviderForm } from './CustomProviderForm'

import type { CliLoginProvider } from '../../api'
import type { RuntimeInstance } from '../../types/runtime'

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * A model provider of the user's own for one local agent: a base URL, a key and optional
 * model ids, used the way the agent's own CLI supports one. The key goes to the main process
 * once and is never shown again. Shown on this computer's own agent, under its header; the saved
 * value comes back with the local runtime's broadcast.
 */
export function CustomProviderSettings({ instance }: { instance: RuntimeInstance }) {
  const provider = ownCliProvider(instance, useThisComputer())

  return provider ? <ProviderRow provider={provider} /> : null
}

function ProviderRow({ provider }: { provider: CliLoginProvider }) {
  const state = useLocalRuntimeState()
  const agent = state?.agents[provider]
  const saved = state?.customProviders?.[provider]
  const name = agentProvider(provider).label
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)

  async function remove() {
    setRemoving(true)
    try {
      await api.localRuntimeSetCustomProvider(provider, null)
      toast.success(t('Custom provider removed'))
    } catch (cause) {
      toast.apiError(t('Could not remove the custom provider'), cause)
    } finally {
      setRemoving(false)
    }
  }

  if (!agent?.available) return null

  if (editing)
    return (
      <CustomProviderForm
        provider={provider}
        saved={saved}
        onCancel={() => setEditing(false)}
        onSave={async (value) => {
          await api.localRuntimeSetCustomProvider(provider, value)
          setEditing(false)
          toast.success(t('Custom provider saved'))
        }}
      />
    )

  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0 space-y-0.5 text-[12px] text-tertiary">
        <div className="text-[13px] font-medium text-main">{t('Custom provider')}</div>
        {saved ? (
          <>
            <div className="truncate" title={saved.baseUrl}>
              {hostOf(saved.baseUrl)}
              {saved.models.length > 0 && <span> · {saved.models.join(', ')}</span>}
            </div>
            {agent.cli?.installed && agent.cli.customProvider && agent.cli.loggedIn !== true && (
              <div role="alert" className="text-error">
                {t('Could not read the custom provider’s API key. Edit it to enter the key again.')}
              </div>
            )}
          </>
        ) : (
          <div>
            {t('Use your own gateway or a compatible API instead of signing in to {name}.', {
              name,
            })}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        {saved && (
          <Button size="sm" variant="ghost" disabled={removing} onClick={() => void remove()}>
            {t('Remove')}
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={removing} onClick={() => setEditing(true)}>
          {saved ? t('Edit') : t('Set up')}
        </Button>
      </div>
    </div>
  )
}
