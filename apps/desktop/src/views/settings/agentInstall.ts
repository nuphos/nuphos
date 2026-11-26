import type { AgentProvider } from '../../types/runtime'

/**
 * Where each agent's installer downloads it from, and the command that installs it by hand.
 * The runtime runs the same installers (electron/main/local-runtime/agent-cli-install.ts).
 */
export const AGENT_INSTALL: Partial<
  Record<AgentProvider, { maker: string; install: string; windows?: string }>
> = {
  'claude-code': {
    maker: 'claude.ai',
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    windows: 'irm https://claude.ai/install.ps1 | iex',
  },
  // Windows rarely has Node.js; the ChatGPT app from the Microsoft Store ships codex.exe.
  codex: {
    maker: 'npmjs.com',
    install: 'npm install -g @openai/codex',
    windows: 'winget install --id 9PLM9XGG6VKS -s msstore',
  },
  grok: {
    maker: 'x.ai',
    install: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    windows: 'irm https://x.ai/cli/install.ps1 | iex',
  },
  hermes: {
    maker: 'nousresearch.com',
    install:
      'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive',
  },
  cursor: { maker: 'cursor.com', install: 'curl -fsSL https://cursor.com/install | bash' },
  opencode: { maker: 'npmjs.com', install: 'npm install -g opencode-ai' },
  pi: { maker: 'npmjs.com', install: 'npm install -g @earendil-works/pi-coding-agent' },
  dsh: { maker: 'npmjs.com', install: 'npm install -g @deepseek-ai/dsh@latest' },
}
