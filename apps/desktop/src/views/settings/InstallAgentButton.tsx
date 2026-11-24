import { Download, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { isWindows } from '../../lib/platform'

import type { CliLoginProvider } from '../../api'

const AGENT: Record<CliLoginProvider, { name: string; install: string }> = {
  'claude-code': {
    name: 'Claude Code',
    install: isWindows
      ? 'irm https://claude.ai/install.ps1 | iex'
      : 'curl -fsSL https://claude.ai/install.sh | bash',
  },
  codex: {
    name: 'Codex',
    // Windows rarely has Node.js; the ChatGPT app from the Microsoft Store ships codex.exe.
    install: isWindows
      ? 'winget install --id 9PLM9XGG6VKS -s msstore'
      : 'npm install -g @openai/codex',
  },
}

/** Runs the vendor's own installer here, so nobody has to find a terminal first. */
export function InstallButton({ provider }: { provider: CliLoginProvider }) {
  const [installing, setInstalling] = useState(false)
  const { name, install } = AGENT[provider]

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
