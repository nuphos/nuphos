import { Download, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { isWindows } from '../../lib/platform'
import { agentProvider } from '../../types/runtime'

import { AGENT_INSTALL } from './agentInstall'

import type { CliLoginProvider } from '../../api'

/** Runs the vendor's own installer here, so nobody has to find a terminal first. */
export function InstallButton({ provider }: { provider: CliLoginProvider }) {
  const [installing, setInstalling] = useState(false)
  const name = agentProvider(provider).label
  const command = AGENT_INSTALL[provider]
  const install = (isWindows && command?.windows) || (command?.install ?? '')

  async function start() {
    setInstalling(true)
    try {
      const state = await api.localRuntimeInstallAgent(provider)

      if (state.agents[provider].cli?.installed) toast.success(t('{name} installed', { name }))
      else
        toast.info(
          t('{name} was installed but not found yet', { name }),
          t('Restart Nuphos, then check again.'),
        )
    } catch (err) {
      toast.apiError(t('Could not install {name}', { name }), err, {
        fallback: isWindows
          ? t('Run `{command}` in PowerShell to see why.', { command: install })
          : t('Run `{command}` in a terminal to see why.', { command: install }),
      })
    } finally {
      setInstalling(false)
    }
  }

  return (
    <Button size="sm" variant="secondary" disabled={installing} onClick={() => void start()}>
      {installing ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
      ) : (
        <Download strokeWidth={1.5} className="mr-1.5 h-3.5 w-3.5" />
      )}
      {installing ? t('Installing…') : t('Install {name}', { name })}
    </Button>
  )
}
