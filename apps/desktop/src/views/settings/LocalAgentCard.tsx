import clsx from 'clsx'
import { Download, Loader2, RotateCw } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { useLocalAgentUpdate } from '../../hooks/useAgentUpdates'
import { useTextSwap } from '../../hooks/useTextSwap'
import { isWindows } from '../../lib/platform'

import { unbundledStatus } from './localAgentBundle'
import { LocalAgentSignIn } from './LocalAgentSignIn'
import { STATUS_DOT } from './runtimePresentation'

import type { RuntimeStatusTone } from './runtimePresentation'
import type { AgentCliStatus, CliLoginProvider, DevBundleHint, LocalAgentState } from '../../api'

export const LOCAL_AGENT_CARD = 'rounded-lg border border-zGray-800/70 bg-surface'

const AGENT: Record<
  CliLoginProvider,
  { name: string; install: string; app: string; connectors: string }
> = {
  'claude-code': {
    name: 'Claude Code',
    install: isWindows
      ? 'irm https://claude.ai/install.ps1 | iex'
      : 'curl -fsSL https://claude.ai/install.sh | bash',
    app: 'The Claude desktop app works too, once its Code tab has been opened.',
    connectors:
      'Your own Claude Code settings, CLAUDE.md, hooks, plugins, skills, MCP servers and claude.ai connectors are never loaded.',
  },
  codex: {
    name: 'Codex',
    // Windows rarely has Node.js; the ChatGPT app from the Microsoft Store ships codex.exe.
    install: isWindows
      ? 'winget install --id 9PLM9XGG6VKS -s msstore'
      : 'npm install -g @openai/codex',
    app: 'The ChatGPT desktop app works too: it comes with Codex.',
    connectors: 'Your own Codex config, MCP servers and connectors are never loaded.',
  },
}

/** Runs the vendor's own installer here, so nobody has to find a terminal first. */
function InstallButton({ provider }: { provider: CliLoginProvider }) {
  const [installing, setInstalling] = useState(false)
  const { name, install } = AGENT[provider]

  async function start() {
    setInstalling(true)
    try {
      const state = await api.localRuntimeInstallAgent(provider)

      if (state.agents[provider].cli?.installed) toast.success(`${name} installed`)
      else
        toast.info(`${name} was installed but not found yet`, 'Restart Nuphos, then check again.')
    } catch (err) {
      toast.apiError(`Could not install ${name}`, err, {
        fallback: `Run \`${install}\` in ${isWindows ? 'PowerShell' : 'a terminal'} to see why.`,
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
      {installing ? 'Installing…' : `Install ${name}`}
    </Button>
  )
}

function statusLine(agent: LocalAgentState): { label: string; tone: RuntimeStatusTone } {
  if (agent.cli?.installed && agent.cli.loggedIn !== true)
    return { label: 'Sign in to connect this agent', tone: 'off' }
  if (agent.online) return { label: 'Ready for your conversations', tone: 'online' }
  if (agent.cli?.installed === false) return { label: 'Not installed', tone: 'off' }
  if (agent.error) return { label: agent.error, tone: 'error' }

  return { label: 'Offline', tone: 'off' }
}

function Code({ children }: { children: string }) {
  return (
    <code className="select-all rounded bg-surface px-1.5 py-0.5 font-mono text-[11.5px] text-main">
      {children}
    </code>
  )
}

/** Shown only when a newer release exists; the update itself is shared with every agent selector. */
function UpdateButton({ provider }: { provider: CliLoginProvider }) {
  const { version, updating, start } = useLocalAgentUpdate(provider)

  if (!version && !updating) return null

  return (
    <Button size="sm" variant="secondary" disabled={updating} onClick={start}>
      {updating ? (
        <>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          Updating…
        </>
      ) : (
        `Update to v${version ?? ''}`
      )}
    </Button>
  )
}

function CliStatus({ provider, cli }: { provider: CliLoginProvider; cli: AgentCliStatus | null }) {
  const agent = AGENT[provider]

  if (!cli) return <p className="text-[12px] text-tertiary">Checking {agent.name}…</p>
  if (!cli.installed)
    return (
      <div className="space-y-1.5 text-[12px] text-tertiary">
        <p className="font-medium text-warning">{agent.name} is not installed on this computer.</p>
        <p>
          Install it here, or from {isWindows ? 'PowerShell' : 'a terminal'} with{' '}
          <Code>{agent.install}</Code>, then check again. {agent.app}
        </p>
        <InstallButton provider={provider} />
      </div>
    )

  return (
    <div className="space-y-2 text-[12px] text-tertiary">
      <p>
        {cli.loggedIn === true
          ? `Signed in to ${agent.name}.`
          : cli.loggedIn === null
            ? `Could not read the ${agent.name} sign-in. Check again or sign in.`
            : `Connect ${agent.name} to use this computer as your agent.`}
        {cli.loggedIn && cli.account && <span> {cli.account}</span>}
        {cli.plan && <span> · {cli.plan}</span>}
        {cli.version && <span> · v{cli.version}</span>}
      </p>
      <div className="flex items-center gap-2">
        <LocalAgentSignIn
          provider={provider}
          label={cli.loggedIn === true ? 'Sign in again' : `Sign in with ${agent.name}`}
        />
        <UpdateButton provider={provider} />
      </div>
    </div>
  )
}

/** One agent this computer runs: where it stands, and its own CLI's sign-in. */
export function LocalAgentCard({
  provider,
  agent,
  devBundle,
  onCheck,
}: {
  provider: CliLoginProvider
  agent: LocalAgentState
  devBundle?: DevBundleHint
  onCheck: () => void
}) {
  const { name, connectors } = AGENT[provider]
  const status = agent.available ? statusLine(agent) : unbundledStatus(name, devBundle)
  const { ref: labelRef, text: labelText } = useTextSwap<HTMLSpanElement>(status.label)

  return (
    <div className={LOCAL_AGENT_CARD}>
      <div className="px-4 py-3.5">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-main">{name}</div>
          <div className="mt-0.5 text-[12px] text-tertiary">
            Once {name} is installed and signed in, your own conversations in any of your teams can
            run it here while Nuphos is open — including shell commands with your user&apos;s
            access. Nobody else can use it. {connectors}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-zGray-800/60 px-4 py-2.5 text-[12px] text-secondary">
        <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[status.tone])} />
        <span ref={labelRef} className="t-text-swap min-w-0 truncate" title={status.label}>
          {labelText}
        </span>
      </div>
      <div className="flex items-start justify-between gap-4 border-t border-zGray-800/60 px-4 py-3">
        <div className="min-w-0">
          <CliStatus provider={provider} cli={agent.cli} />
        </div>
        <Button variant="ghost" size="sm" onClick={onCheck}>
          <RotateCw strokeWidth={1.5} className="mr-1.5 h-3.5 w-3.5" />
          Check again
        </Button>
      </div>
    </div>
  )
}
