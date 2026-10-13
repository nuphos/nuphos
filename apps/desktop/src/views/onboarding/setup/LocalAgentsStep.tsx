import clsx from 'clsx'
import { ExternalLink, Loader2 } from 'lucide-react'

import { ClaudeIcon, CodexIcon } from '../../../components/agent/panel/icons'
import { Button } from '../../../components/ui/button'
import { useLocalRuntimeState } from '../../../hooks/useLocalRuntimeState'
import { isMac } from '../../../lib/platform'
import { useLocalAgentLogin } from '../../settings/useLocalAgentLogin'

import { LOCAL_AGENT_INFO, LOCAL_SETUP_PROVIDERS, localAgentStatus } from './agentSetup'
import { SetupScreen, StatusPill } from './SetupChrome'

import type { LocalAgentProvider } from '../../../api'

const ICON = { 'claude-code': ClaudeIcon, codex: CodexIcon } as const

/** Sign-in inside the card: start it, then follow the browser step until the CLI reports back. */
function InlineSignIn({ provider }: { provider: LocalAgentProvider }) {
  const { login, busy, retry, start, cancel } = useLocalAgentLogin(provider, true)

  if (!busy)
    return (
      <Button size="sm" onClick={() => void start()}>
        {retry ? 'Try again' : 'Sign in'}
      </Button>
    )

  return (
    <div className="w-full space-y-2 text-[12.5px] text-secondary" role="status" aria-live="polite">
      <p className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {login?.state === 'checking'
          ? 'Verifying your sign-in…'
          : 'Finish signing in in your browser…'}
      </p>
      {login?.userCode && (
        <p>
          Enter this one-time code:{' '}
          <code className="select-all font-semibold text-main">{login.userCode}</code>
        </p>
      )}
      <div className="flex items-center gap-3">
        {login?.url && (
          <a
            href={login.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zViolet-400 underline"
          >
            {login.userCode ? 'Open the sign-in page' : 'Reopen the sign-in page'}
          </a>
        )}
        <Button size="sm" variant="ghost" onClick={() => void cancel()}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function LocalAgentSetupCard({ provider }: { provider: LocalAgentProvider }) {
  const state = useLocalRuntimeState()
  const status = localAgentStatus(state?.agents[provider].cli)
  const { name, maker, installUrl } = LOCAL_AGENT_INFO[provider]
  const Icon = ICON[provider]

  return (
    <div
      className={clsx(
        'space-y-3 rounded-xl border border-zGray-800 bg-zGray-900 px-4 py-3.5',
        status === 'missing' && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zGray-800 text-main">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-main">{name}</p>
          <p className="text-[12px] text-tertiary">{maker}</p>
        </div>
        <StatusPill status={status} />
      </div>
      {status === 'signed-out' && <InlineSignIn provider={provider} />}
      {status === 'missing' && (
        <a
          href={installUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[12.5px] text-zViolet-400 hover:underline"
        >
          How to install <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  )
}

export function LocalAgentsStep({ onContinue }: { onContinue: () => void }) {
  const computer = isMac ? 'this Mac' : 'this computer'

  return (
    <SetupScreen
      title={`Connect agents on ${computer}`}
      subtitle={`Nuphos runs these agents with the subscriptions you already have. Here’s what we found on ${computer}.`}
      hint="You can change this later in Settings › Agents."
      actions={<Button onClick={onContinue}>Continue</Button>}
    >
      <div className="space-y-3">
        {LOCAL_SETUP_PROVIDERS.map((provider) => (
          <LocalAgentSetupCard key={provider} provider={provider} />
        ))}
      </div>
    </SetupScreen>
  )
}
