import clsx from 'clsx'
import { RotateCw } from 'lucide-react'

import { Button } from '../../components/ui/button'
import { useTextSwap } from '../../hooks/useTextSwap'

import { unbundledStatus } from './localAgentBundle'
import { LocalAgentSignIn } from './LocalAgentSignIn'
import { STATUS_DOT } from './runtimePresentation'

import type { RuntimeStatusTone } from './runtimePresentation'
import type { AgentCliStatus, DevBundleHint, LocalAgentProvider, LocalAgentState } from '../../api'

export const LOCAL_AGENT_CARD = 'rounded-lg border border-zGray-800/70 bg-surface'

const AGENT: Record<LocalAgentProvider, { name: string; install: string; connectors: string }> = {
  'claude-code': {
    name: 'Claude Code',
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    connectors:
      'Your own Claude Code settings, CLAUDE.md, hooks, plugins, skills, MCP servers and claude.ai connectors are never loaded.',
  },
  codex: {
    name: 'Codex',
    install: 'npm install -g @openai/codex',
    connectors: 'Your own Codex config, MCP servers and connectors are never loaded.',
  },
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
    <code className="select-all rounded bg-field px-1.5 py-0.5 font-mono text-[11.5px] text-main">
      {children}
    </code>
  )
}

function CliStatus({
  provider,
  cli,
}: {
  provider: LocalAgentProvider
  cli: AgentCliStatus | null
}) {
  const agent = AGENT[provider]

  if (!cli) return <p className="text-[12px] text-tertiary">Checking {agent.name}…</p>
  if (!cli.installed)
    return (
      <div className="space-y-1.5 text-[12px] text-tertiary">
        <p className="font-medium text-warning">{agent.name} is not installed on this computer.</p>
        <p>
          Install it from a terminal with <Code>{agent.install}</Code>, then check again.
        </p>
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
      </p>
      <LocalAgentSignIn
        provider={provider}
        label={cli.loggedIn === true ? 'Sign in again' : `Sign in with ${agent.name}`}
      />
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
  provider: LocalAgentProvider
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
